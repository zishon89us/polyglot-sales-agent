-- Reverses 0014_unreadable_batches.up.sql. How many batches in a row
-- each session could not read is lost.
ALTER TABLE sessions DROP COLUMN unreadable_batches;
