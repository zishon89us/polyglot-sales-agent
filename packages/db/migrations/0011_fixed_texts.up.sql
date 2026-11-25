-- The disclosure, a fixed text before a reply, and buttons on a sent
-- message (M3 unit U8; design note
-- docs/design/notes/m3-u8-fixed-texts.md, sections 4 to 7).

-- When the session's customer was told that an automated assistant is
-- replying: when the channel accepted a message that carried the
-- disclosure. Taken off again if that message is reported failed later.
ALTER TABLE sessions ADD COLUMN disclosed_at timestamptz;

-- The language of the last reply to the contact, when it was a supported
-- one: what a fixed text is sent in when nothing newer is known.
ALTER TABLE contacts ADD COLUMN last_language text CHECK (last_language ~ '^[a-z]{2}$');

ALTER TABLE messages
  -- The disclosure that was sent with the message. Decided each time the
  -- message is taken to be sent, never kept from an earlier try.
  ADD COLUMN disclosure text CHECK (char_length(disclosure) BETWEEN 1 AND 150),
  -- A fixed text that code put before the body. Never written by the model.
  ADD COLUMN lead text CHECK (char_length(lead) BETWEEN 1 AND 700),
  -- The buttons the customer was shown: a list of 1 or 2, each a payload
  -- and a title. Null when there were none, and set to null when a message
  -- written with buttons was sent without them.
  ADD COLUMN buttons jsonb,
  ADD CONSTRAINT messages_fixed_parts_are_sent
    CHECK (direction = 'outbound'
           OR (disclosure IS NULL AND lead IS NULL AND buttons IS NULL));

-- What a stored message of ours must be, beyond the above: a fixed part
-- has something to read, and each button is exactly a payload and a
-- title, both short texts that are not empty.
CREATE FUNCTION message_buttons_ok(buttons jsonb) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  RETURN CASE WHEN jsonb_typeof(buttons) <> 'array' THEN false ELSE
    jsonb_array_length(buttons) BETWEEN 1 AND 2
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(buttons) AS button
      WHERE CASE WHEN jsonb_typeof(button) <> 'object' THEN true ELSE
        (SELECT count(*) FROM jsonb_object_keys(button)) <> 2
        OR jsonb_typeof(button -> 'payload') IS DISTINCT FROM 'string'
        OR jsonb_typeof(button -> 'title') IS DISTINCT FROM 'string'
        OR char_length(button ->> 'payload') NOT BETWEEN 1 AND 256
        OR char_length(button ->> 'title') NOT BETWEEN 1 AND 20
        OR (button ->> 'title') !~ '\S'
      END)
  END;
REVOKE ALL ON FUNCTION message_buttons_ok(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION message_buttons_ok(jsonb) TO psa_app, psa_cross;

ALTER TABLE messages
  ADD CONSTRAINT messages_fixed_parts_are_not_blank
    CHECK ((disclosure IS NULL OR disclosure ~ '\S')
           AND (lead IS NULL OR lead ~ '\S')),
  ADD CONSTRAINT messages_buttons_are_buttons
    CHECK (buttons IS NULL OR message_buttons_ok(buttons));

-- A receipt that arrived before the send it is about was recorded. The
-- channel can report a message failed in the moment between accepting it
-- and the worker storing that it was accepted; until then no row has the
-- channel's identifier, and the receipt matched nothing. It is kept here
-- and applied when the send is recorded, so that a message is not left
-- "sent", and its session marked as told, after the channel said it
-- failed. Rows over a day old are removed when a new one is kept.
CREATE TABLE early_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  channel_message_id text NOT NULL CHECK (char_length(channel_message_id) BETWEEN 1 AND 1024),
  status text NOT NULL CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
  error_code text,
  UNIQUE (tenant_id, channel_message_id, status)
);
ALTER TABLE early_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE early_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON early_receipts FOR ALL TO psa_app
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT, INSERT, DELETE ON early_receipts TO psa_app;
