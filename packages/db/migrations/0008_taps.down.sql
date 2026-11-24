-- The way back from 0008. What a tap carried, what it answered and that a
-- text was a caption are lost. A tap stays a row of kind `button`, as it
-- could be before, and a row this migration renamed keeps its new name.
ALTER TABLE messages
  DROP CONSTRAINT messages_caption_is_inbound_text,
  DROP CONSTRAINT messages_tap_has_no_body,
  DROP CONSTRAINT messages_only_a_tap_answers,
  DROP CONSTRAINT messages_tap_has_payload,
  DROP COLUMN caption_of,
  DROP COLUMN in_reply_to,
  DROP COLUMN button_payload;
