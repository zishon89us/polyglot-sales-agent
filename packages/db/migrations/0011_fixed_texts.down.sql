-- Reverses 0011_fixed_texts.up.sql. What was sent before a reply's body,
-- which buttons a message had, whether a session's customer was told, and
-- each contact's last language are lost. A session whose customer was
-- told is, after going forward again, told once more.
ALTER TABLE messages
  DROP CONSTRAINT messages_fixed_parts_are_sent,
  DROP COLUMN buttons,
  DROP COLUMN lead,
  DROP COLUMN disclosure;
ALTER TABLE contacts DROP COLUMN last_language;
ALTER TABLE sessions DROP COLUMN disclosed_at;
