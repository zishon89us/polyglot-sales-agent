-- Reverses 0003_inbound_events.up.sql. The records of unreadable and
-- unroutable events are lost, and so is every contact's channel identifier:
-- a contact who has no phone number can then no longer be matched.
DROP TABLE unroutable_events;
DROP TABLE unparsed_events;
ALTER TABLE contacts
  DROP CONSTRAINT contacts_channel_user_unique,
  DROP COLUMN channel_user_id;
