-- Reverses 0010_turn.up.sql. Every record of a tool's run is lost, and so
-- are each session's language and mark and which turn made which reply.
DROP TABLE tool_calls;
DROP INDEX messages_session;
ALTER TABLE messages
  DROP CONSTRAINT messages_turn_made_a_reply,
  DROP COLUMN language,
  DROP COLUMN turn_id;
ALTER TABLE sessions
  DROP COLUMN unsupported_language,
  DROP COLUMN language;
