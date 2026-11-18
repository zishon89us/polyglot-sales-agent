-- What the webhook stores (unit U7): the channel's own identifier for a
-- customer, and the two records of events that reach no tenant.

-- A WhatsApp customer who uses a username arrives with no phone number,
-- only an identifier the channel gives the business for that person
-- (issue #284). A contact is matched on it first, then on the number.
ALTER TABLE contacts
  ADD COLUMN channel_user_id text CHECK (channel_user_id ~ '^[\x21-\x7e]{1,140}$'),
  ADD CONSTRAINT contacts_channel_user_unique UNIQUE (tenant_id, channel_user_id);

-- What the channel says about a message and will not say again: when it was
-- sent, and, for a failed one, why. `kind` already holds the channel's name
-- for a type this version does not read.
ALTER TABLE messages
  ADD COLUMN channel_sent_at timestamptz,
  ADD COLUMN error_code text CHECK (error_code ~ '^[A-Za-z0-9_-]{1,40}$');

-- A message is unique by its channel identifier within its direction: what
-- a customer sent and what the business sent are numbered apart, and one
-- must never be taken for a duplicate of the other.
ALTER TABLE messages
  DROP CONSTRAINT messages_tenant_id_channel_message_id_key,
  ADD CONSTRAINT messages_channel_identifier_unique
    UNIQUE (tenant_id, direction, channel_message_id);

-- A validly signed webhook, or part of one, that could not be read. It has
-- no tenant. Only what cannot identify anyone is kept: a hash of the body,
-- its size and a code. Never the body, a number or any text.
CREATE TABLE unparsed_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at timestamptz NOT NULL DEFAULT now(),
  channel text NOT NULL CHECK (channel ~ '^[a-z]{1,20}$'),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  size_bytes integer NOT NULL CHECK (size_bytes >= 0),
  error_code text NOT NULL CHECK (error_code ~ '^[a-z-]{1,40}$'),
  -- How many messages or statuses were left out; null when the whole body was unreadable.
  items_left_out integer CHECK (items_left_out > 0),
  -- The channel sends an unanswered webhook again; the same body is one row.
  UNIQUE (channel, payload_hash)
);
GRANT SELECT, INSERT ON unparsed_events TO psa_cross;

-- An event for a receiving number that belongs to no tenant. The sender's
-- number and the message are not kept: they belong to people the system has
-- no relationship with.
CREATE TABLE unroutable_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at timestamptz NOT NULL DEFAULT now(),
  channel text NOT NULL CHECK (channel ~ '^[a-z]{1,20}$'),
  receiving_number_id text NOT NULL CHECK (receiving_number_id ~ '^[\x21-\x7e]{1,64}$'),
  channel_message_id text NOT NULL CHECK (channel_message_id ~ '^[\x21-\x7e]{1,128}$'),
  kind text NOT NULL CHECK (kind IN ('message', 'status')),
  UNIQUE (channel, receiving_number_id, channel_message_id, kind)
);
GRANT SELECT, INSERT ON unroutable_events TO psa_cross;
