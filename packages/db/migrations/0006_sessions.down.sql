-- Reverses 0006_sessions.up.sql. What is lost: which session each message
-- was in, which reply answered which message, each contact's reply window
-- and each session's count of dropped replies. Applying the up migration
-- again makes sessions afresh from the messages' stored times.
--
-- Not undone: the up migration marked the unanswered messages of sessions
-- that were already over as dealt with, and discarded their replies that
-- had never reached the channel. Those marks stay.
--
-- Stop the API and the workers before running this.
DROP INDEX messages_answered_by;
ALTER TABLE messages
  DROP CONSTRAINT messages_answered_by_fk,
  DROP CONSTRAINT messages_session_fk,
  DROP CONSTRAINT messages_answered_is_inbound,
  DROP COLUMN answered_by,
  DROP COLUMN session_id;
ALTER TABLE conversations DROP COLUMN turn_started_at;
ALTER TABLE contacts DROP COLUMN last_inbound_at;
DROP TABLE sessions;
