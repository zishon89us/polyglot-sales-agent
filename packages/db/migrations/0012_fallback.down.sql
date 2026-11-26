-- Reverses 0012_fallback.up.sql. Which messages were fallbacks, how many
-- each session was sent in a row, and what the checks said of each turn
-- are lost.
DROP TABLE reply_checks;
ALTER TABLE messages
  DROP CONSTRAINT messages_fallback_is_a_reply_with_no_body,
  DROP COLUMN fallback;
ALTER TABLE sessions DROP COLUMN guardrail_fallbacks;
