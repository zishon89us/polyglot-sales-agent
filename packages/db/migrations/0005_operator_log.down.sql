-- Reverses 0005_operator_log.up.sql. What is lost: the whole record of what
-- the operator did. Copy the table out first if it is to be kept.
DROP TABLE operator_log;
DROP FUNCTION operator_log_is_insert_only();
DROP FUNCTION operator_arguments_ok(jsonb);
