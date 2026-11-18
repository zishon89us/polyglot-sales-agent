-- Reverses 0003_inbound_events.up.sql. The records of unreadable and
-- unroutable events are lost, and so is every contact's channel identifier:
-- a contact who has no phone number can then no longer be matched. It fails
-- if a customer's message and a sent message share a channel identifier.
DROP TABLE unroutable_events;
DROP TABLE unparsed_events;
ALTER TABLE contacts
  DROP CONSTRAINT contacts_channel_user_unique,
  DROP COLUMN channel_user_id;
ALTER TABLE messages
  DROP CONSTRAINT messages_channel_identifier_unique,
  ADD CONSTRAINT messages_tenant_id_channel_message_id_key UNIQUE (tenant_id, channel_message_id);
ALTER TABLE messages
  DROP COLUMN error_code,
  DROP COLUMN channel_sent_at;
