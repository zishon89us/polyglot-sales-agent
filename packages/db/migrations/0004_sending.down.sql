-- Reverses 0004_sending.up.sql. What is lost: which of the customer's
-- messages were dealt with, and how often each message was sent. A message
-- that is being sent when this runs keeps the status `sending` and loses
-- the time, so nothing can tell how long it has been so.
DROP INDEX messages_unhandled;
DROP INDEX messages_to_send;
ALTER TABLE messages
  DROP COLUMN sent_at,
  DROP COLUMN send_not_before,
  DROP COLUMN sending_at,
  DROP COLUMN unknown_outcomes,
  DROP COLUMN send_attempts,
  DROP COLUMN handled_at;
