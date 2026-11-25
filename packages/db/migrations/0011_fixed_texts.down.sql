-- Reverses 0011_fixed_texts.up.sql. What was sent before a reply's body,
-- which buttons a message had, whether a session's customer was told, and
-- each contact's last language are lost. A session whose customer was
-- told is, after going forward again, told once more.
-- Receipts kept for sends not yet recorded are lost: such a message stays "sent".
DROP TABLE early_receipts;
ALTER TABLE messages
  DROP CONSTRAINT messages_buttons_are_buttons,
  DROP CONSTRAINT messages_fixed_parts_are_not_blank,
  DROP CONSTRAINT messages_fixed_parts_are_sent,
  DROP COLUMN buttons,
  DROP COLUMN lead,
  DROP COLUMN disclosure;
DROP FUNCTION message_buttons_ok(jsonb);
ALTER TABLE contacts DROP COLUMN last_language;
ALTER TABLE sessions DROP COLUMN disclosed_at;
