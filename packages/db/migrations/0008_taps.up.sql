-- A tap on a button and a caption, as they are stored (M3 unit U5; design
-- note docs/design/notes/m3-u5-buttons-captions.md, section 4).

-- `button` is this system's own name for a tap that was read. Before this
-- migration a channel's own type of that name (a template's quick reply)
-- could be stored under it, with nothing of the tap kept. Such a row is
-- renamed, so that every `button` from a customer has a payload.
-- The owner is under the tenant policy like any role, and would see no
-- row; the policy is lifted for the one statement, in this transaction.
ALTER TABLE messages NO FORCE ROW LEVEL SECURITY;
UPDATE messages SET kind = 'quick-reply' WHERE direction = 'inbound' AND kind = 'button';
ALTER TABLE messages FORCE ROW LEVEL SECURITY;

ALTER TABLE messages
  -- What the button carried. From the customer's app: untrusted.
  ADD COLUMN button_payload text
    -- The length is checked apart: a count in a pattern stops at 255.
    CHECK (char_length(button_payload) BETWEEN 1 AND 256 AND button_payload ~ '^[\x21-\x7e]+$'),
  -- The channel's identifier of the message the tap answers, as the tap
  -- named it. Kept as text, not as a link: the message may get its
  -- identifier after the tap is stored, or never.
  ADD COLUMN in_reply_to text
    CHECK (in_reply_to ~ '^[\x21-\x7e]{1,128}$'),
  -- For a text that was typed under a picture or a video.
  ADD COLUMN caption_of text
    CHECK (caption_of IN ('image', 'video')),
  -- A tap from a customer has a payload, and nothing else has one.
  ADD CONSTRAINT messages_tap_has_payload
    CHECK ((direction = 'inbound' AND kind = 'button') = (button_payload IS NOT NULL)),
  ADD CONSTRAINT messages_only_a_tap_answers
    CHECK (in_reply_to IS NULL OR button_payload IS NOT NULL),
  -- A tap has no text: only a text's body is the customer's words.
  ADD CONSTRAINT messages_tap_has_no_body
    CHECK (button_payload IS NULL OR body IS NULL),
  ADD CONSTRAINT messages_caption_is_inbound_text
    CHECK (caption_of IS NULL OR (direction = 'inbound' AND kind = 'text'));
