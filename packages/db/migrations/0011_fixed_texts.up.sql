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
