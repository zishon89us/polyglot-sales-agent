-- What the worker needs to answer a conversation and send a message once
-- (M2 unit U8; architecture, "Sending a message once").

ALTER TABLE messages
  -- For a customer's message: when a turn dealt with it. Null until then.
  ADD COLUMN handled_at timestamptz,
  -- For a message to send: how many times the channel was called for it,
  ADD COLUMN send_attempts integer NOT NULL DEFAULT 0 CHECK (send_attempts >= 0),
  -- how many of those calls ended without anyone knowing whether the
  -- channel accepted the message,
  ADD COLUMN unknown_outcomes integer NOT NULL DEFAULT 0 CHECK (unknown_outcomes >= 0),
  -- when the call now under way started,
  ADD COLUMN sending_at timestamptz,
  -- the earliest time of the next call, after a refusal that can be retried,
  ADD COLUMN send_not_before timestamptz,
  -- and when the channel accepted it.
  ADD COLUMN sent_at timestamptz,
  ADD CONSTRAINT messages_unknown_within_attempts CHECK (unknown_outcomes <= send_attempts),
  -- Exactly a message whose call is under way has the time it started.
  ADD CONSTRAINT messages_sending_has_time
    CHECK ((status IS NOT DISTINCT FROM 'sending') = (sending_at IS NOT NULL)),
  ADD CONSTRAINT messages_handled_is_inbound CHECK (handled_at IS NULL OR direction = 'inbound');

-- The next message to send in a conversation, and whether any is waiting.
CREATE INDEX messages_to_send ON messages (tenant_id, conversation_id, created_at, id)
  WHERE status IN ('pending', 'sending');
-- The customer's messages a turn has not dealt with yet.
CREATE INDEX messages_unhandled ON messages (tenant_id, conversation_id, created_at, id)
  WHERE direction = 'inbound' AND handled_at IS NULL;
