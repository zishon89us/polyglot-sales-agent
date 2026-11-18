-- Reverses 0004_sending.up.sql. What is lost: which of the customer's
-- messages were dealt with, and how often each message was sent.
--
-- A message that is being sent when this runs becomes `failed` with the
-- code `unconfirmed`: without the time its call started nothing could ever
-- resolve it, and the up migration could not be applied again.
--
-- Stop the workers before running this, and do not apply the up migration
-- again on a database with conversations in it without first deciding what
-- is still to be answered: afterwards every message a customer ever sent
-- counts as not dealt with.
--
-- The migration role sees no rows of a tenant's table while row-level
-- security is forced on it, so it is lifted for the one statement, inside
-- this transaction.
ALTER TABLE messages NO FORCE ROW LEVEL SECURITY;
UPDATE messages SET status = 'failed', error_code = 'unconfirmed', sending_at = NULL
  WHERE status = 'sending';
ALTER TABLE messages FORCE ROW LEVEL SECURITY;
DROP INDEX messages_unhandled;
DROP INDEX messages_to_send;
ALTER TABLE messages
  DROP COLUMN sent_at,
  DROP COLUMN send_not_before,
  DROP COLUMN sending_at,
  DROP COLUMN unknown_outcomes,
  DROP COLUMN send_attempts,
  DROP COLUMN handled_at;
