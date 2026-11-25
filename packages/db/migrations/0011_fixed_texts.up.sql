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
  ADD COLUMN buttons jsonb
    CHECK (jsonb_typeof(buttons) = 'array' AND jsonb_array_length(buttons) BETWEEN 1 AND 2),
  ADD CONSTRAINT messages_fixed_parts_are_sent
    CHECK (direction = 'outbound'
           OR (disclosure IS NULL AND lead IS NULL AND buttons IS NULL));

-- What a stored message of ours must be, beyond the above: a fixed part
-- is not blank, and each button is a payload and a title.
ALTER TABLE messages
  ADD CONSTRAINT messages_fixed_parts_are_not_blank
    CHECK ((disclosure IS NULL OR btrim(disclosure, E' \n\t') <> '')
           AND (lead IS NULL OR btrim(lead, E' \n\t') <> '')),
  ADD CONSTRAINT messages_buttons_are_buttons
    CHECK (buttons IS NULL OR NOT jsonb_path_exists(
      buttons,
      '$[*] ? (@.type() != "object" || !(exists(@.payload ? (@.type() == "string"))) || !(exists(@.title ? (@.type() == "string"))))'));

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
