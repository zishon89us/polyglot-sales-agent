-- What a turn with the model records (M3 unit U7; design note
-- docs/design/notes/m3-u7-turn.md, sections 6, 7 and 10).

-- The language the customer wrote in, as the model said, and whether the
-- session was ever answered in a language that is not supported. The mark
-- is the model's word, not a fact; it is never set back.
ALTER TABLE sessions
  ADD COLUMN language text CHECK (language ~ '^[a-z]{2}$'),
  ADD COLUMN unsupported_language boolean NOT NULL DEFAULT false;

ALTER TABLE messages
  -- For an assistant's reply: the turn that made it, so that it can be
  -- joined to the traces of the model calls behind it.
  ADD COLUMN turn_id uuid,
  -- For an assistant's reply: the language its turn reported, 'und' when
  -- the model could not tell. Kept so that a session's mark can be
  -- checked against its replies and worked out again.
  ADD COLUMN language text CHECK (language ~ '^([a-z]{2}|und)$'),
  ADD CONSTRAINT messages_turn_made_a_reply
    CHECK ((turn_id IS NULL AND language IS NULL)
        OR (direction = 'outbound' AND class = 'assistant-reply'
            AND turn_id IS NOT NULL AND language IS NOT NULL));

-- One row for every tool a turn ran.
--
-- `arguments` and `result` are treated as the customer's text: the model
-- writes a tool's arguments and can copy a customer's words into them, and
-- a result can repeat them. Each is removed (set to null) when the row is
-- older than the tenant's retention period and when the contact's data is
-- deleted or anonymised. The jobs that do that are not built (M5); they
-- will need a grant to update those two columns, which is not given here.
-- The rest of the row holds no text and is kept.
CREATE TABLE tool_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  session_id uuid NOT NULL,
  turn_id uuid NOT NULL,
  tool text NOT NULL CHECK (tool ~ '^[a-z][a-z0-9_-]{0,63}$'),
  arguments jsonb,
  result jsonb,
  outcome text NOT NULL CHECK (outcome IN ('done', 'refused', 'failed')),
  ended_at timestamptz NOT NULL,
  -- Only a tool that ran to its end has a result.
  CONSTRAINT tool_calls_result_only_when_done CHECK (result IS NULL OR outcome = 'done'),
  CONSTRAINT tool_calls_ends_after_it_began CHECK (ended_at >= created_at),
  FOREIGN KEY (tenant_id, session_id) REFERENCES sessions (tenant_id, id)
);

CREATE INDEX tool_calls_session ON tool_calls (tenant_id, session_id, created_at);

ALTER TABLE tool_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_calls FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tool_calls FOR ALL TO psa_app
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT, INSERT ON tool_calls TO psa_app;
