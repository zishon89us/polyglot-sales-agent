-- A reply that fails a check is not sent; the fallback is sent in its
-- place and counted (M3 unit U9, second part; design note
-- docs/design/notes/m3-u9-fallback.md).

-- How many fallbacks in a row the session's customer was sent. Moves when
-- the channel accepts a message: plus 1 for a fallback, 0 for any other
-- reply of the assistant.
ALTER TABLE sessions
  ADD COLUMN guardrail_fallbacks integer NOT NULL DEFAULT 0
    CHECK (guardrail_fallbacks BETWEEN 0 AND 100);

-- The turn's reply is the fallback: the fixed text is its `lead`, and it
-- has no body, since the model's reply was refused.
ALTER TABLE messages
  ADD COLUMN fallback boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT messages_fallback_is_a_reply_with_no_body
    CHECK (NOT fallback
           OR (direction = 'outbound' AND class = 'assistant-reply'
               AND body IS NULL AND lead IS NOT NULL));

-- What the checks said of a turn's answer. One row for a turn whose reply
-- or fallback was stored, written in that transaction and never changed.
-- Each check is `passed`, a code of the checker's fixed list, or null when
-- it did not run. No text of the reply, of a claim or of the customer.
CREATE TABLE reply_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  session_id uuid NOT NULL REFERENCES sessions (id),
  turn_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('passed', 'blocked', 'error')),
  o1 text NOT NULL CHECK (o1 ~ '^[a-z][a-z-]{0,39}$'),
  o7 text CHECK (o7 ~ '^[a-z][a-z-]{0,39}$'),
  o6 text CHECK (o6 ~ '^[a-z][a-z-]{0,39}$'),
  o3 text CHECK (o3 ~ '^[a-z][a-z-]{0,39}$'),
  o5 text CHECK (o5 ~ '^[a-z][a-z-]{0,39}$'),
  UNIQUE (tenant_id, turn_id)
);
CREATE INDEX reply_checks_session ON reply_checks (session_id, created_at);
ALTER TABLE reply_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE reply_checks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON reply_checks FOR ALL TO psa_app
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT, INSERT ON reply_checks TO psa_app;
