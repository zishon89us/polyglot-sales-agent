-- Reverses 0013_handovers.up.sql. Every handover is lost, and with it
-- which messages told of one. A session that was handed over is answered
-- by the assistant again. Records of turns that handed over are removed,
-- since their outcome has no name without this migration.
-- The table's rows are seen only by the application's role while row-level
-- security is forced: lifted for the one statement, as 0008 does.
ALTER TABLE reply_checks NO FORCE ROW LEVEL SECURITY;
DELETE FROM reply_checks WHERE outcome = 'handed-over';
ALTER TABLE reply_checks FORCE ROW LEVEL SECURITY;
ALTER TABLE reply_checks
  DROP CONSTRAINT reply_checks_outcome_check,
  ADD CONSTRAINT reply_checks_outcome_check
    CHECK (outcome IN ('passed', 'blocked', 'error'));
ALTER TABLE messages
  DROP CONSTRAINT messages_telling_is_a_system_reply,
  DROP CONSTRAINT messages_handover,
  DROP COLUMN tells,
  DROP COLUMN handover_id;
DROP TABLE handovers;
DROP FUNCTION handover_reasons_ok(text[]);
