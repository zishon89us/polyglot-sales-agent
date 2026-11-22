-- Sessions, the reply window and what a turn needs to answer a batch
-- (M3 unit U2; design note docs/design/notes/m3-u2-sessions.md).
--
-- Stop the API and the workers before running this, and let the messages
-- that wait to be sent go first: a reply waiting at this moment has no
-- record of which messages it answered (see `answered_by`).

-- A run of activity inside a conversation (state machines, section 3).
-- Only the columns this unit writes, and `pack_outcome`, which ADR 0014
-- reserves; the others arrive with the units that use them.
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  conversation_id uuid NOT NULL,
  started_at timestamptz NOT NULL,
  -- The stored time of its newest message, or the time its newest reply
  -- was accepted by the channel. Open while this is under 24 hours ago.
  last_message_at timestamptz NOT NULL,
  -- Set when the conversation is next touched after the 24 hours, not at
  -- the moment they pass: a row with no end may already be over.
  ended_at timestamptz,
  -- How many replies in a row were dropped because the customer wrote
  -- again (design note, D6).
  reply_discards integer NOT NULL DEFAULT 0 CHECK (reply_discards >= 0),
  -- A short label a pack supplies; nothing reads or writes it yet.
  pack_outcome text,
  CHECK (last_message_at >= started_at),
  CHECK (ended_at IS NULL OR ended_at >= last_message_at),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations (tenant_id, id)
);

ALTER TABLE messages
  ADD COLUMN session_id uuid,
  -- For a customer's message: the reply that answered it. Null while it is
  -- not dealt with, and for one dealt with by no reply.
  ADD COLUMN answered_by uuid,
  ADD CONSTRAINT messages_answered_is_inbound CHECK (answered_by IS NULL OR direction = 'inbound');

-- The reply window is open while this is under 24 hours ago.
ALTER TABLE contacts ADD COLUMN last_inbound_at timestamptz;
-- When the conversation's last turn started, for the batching window.
ALTER TABLE conversations ADD COLUMN turn_started_at timestamptz;

-- The existing rows. The migration role sees no rows of a tenant's table
-- while row-level security is forced on it, so it is lifted for these
-- statements, inside this transaction.
ALTER TABLE messages NO FORCE ROW LEVEL SECURITY;
ALTER TABLE contacts NO FORCE ROW LEVEL SECURITY;
ALTER TABLE conversations NO FORCE ROW LEVEL SECURITY;

-- A conversation's messages, both directions, in the order stored, are cut
-- into sessions wherever 24 hours or more lie between one and the next.
-- The stored time is used for every row, sent or not.
INSERT INTO sessions (tenant_id, conversation_id, started_at, last_message_at)
SELECT tenant_id, conversation_id, min(created_at), max(created_at)
FROM (
  SELECT tenant_id, conversation_id, created_at,
         sum(starts) OVER (PARTITION BY tenant_id, conversation_id ORDER BY created_at, id) AS run
  FROM (
    SELECT id, tenant_id, conversation_id, created_at,
           CASE WHEN created_at - lag(created_at) OVER (
                       PARTITION BY tenant_id, conversation_id ORDER BY created_at, id
                     ) < interval '24 hours'
                THEN 0 ELSE 1 END AS starts
    FROM messages
  ) AS marked
) AS numbered
GROUP BY tenant_id, conversation_id, run;

UPDATE messages m SET session_id = s.id
FROM sessions s
WHERE s.tenant_id = m.tenant_id AND s.conversation_id = m.conversation_id
  AND m.created_at >= s.started_at AND m.created_at <= s.last_message_at;

-- Every session but a conversation's last is over. The last is left open
-- whatever its age: it is ended when the conversation is next touched.
UPDATE sessions s SET ended_at = s.last_message_at + interval '24 hours'
WHERE EXISTS (
  SELECT 1 FROM sessions later
  WHERE later.tenant_id = s.tenant_id AND later.conversation_id = s.conversation_id
    AND later.started_at > s.started_at
);

-- Each contact's newest inbound message, by the earlier of the channel's
-- time for it and ours.
UPDATE contacts p SET last_inbound_at = newest.at
FROM (
  SELECT c.tenant_id, c.contact_id,
         max(least(coalesce(m.channel_sent_at, m.created_at), m.created_at)) AS at
  FROM messages m
  JOIN conversations c ON c.tenant_id = m.tenant_id AND c.id = m.conversation_id
  WHERE m.direction = 'inbound'
  GROUP BY c.tenant_id, c.contact_id
) AS newest
WHERE newest.tenant_id = p.tenant_id AND newest.contact_id = p.id;

ALTER TABLE messages FORCE ROW LEVEL SECURITY;
ALTER TABLE contacts FORCE ROW LEVEL SECURITY;
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;

-- The tenant is part of each key, as in 0001: a foreign-key check is not
-- subject to row-level security.
ALTER TABLE messages
  ALTER COLUMN session_id SET NOT NULL,
  ADD CONSTRAINT messages_session_fk
    FOREIGN KEY (tenant_id, session_id) REFERENCES sessions (tenant_id, id),
  ADD CONSTRAINT messages_answered_by_fk
    FOREIGN KEY (tenant_id, answered_by) REFERENCES messages (tenant_id, id);

-- One open session per conversation.
CREATE UNIQUE INDEX sessions_one_open ON sessions (tenant_id, conversation_id)
  WHERE ended_at IS NULL;
-- The messages a discarded reply answered.
CREATE INDEX messages_answered_by ON messages (tenant_id, answered_by)
  WHERE answered_by IS NOT NULL;

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sessions FOR ALL TO psa_app
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY cross_tenant ON sessions FOR ALL TO psa_cross USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON sessions TO psa_app;
