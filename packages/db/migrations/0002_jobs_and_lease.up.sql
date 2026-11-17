-- The job queue, the conversation lease and the worker heartbeat (ADR 0004).

-- A job is claimed by a worker before its tenant is known, so the
-- cross-tenant role reads and changes every row. The application role may
-- only add a job, and only for the tenant of its transaction: the webhook
-- stores a message and queues its job together.
--
-- A finished job is deleted. A job that has failed for the last time stays,
-- in state `dead`.
CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  type text NOT NULL CHECK (type <> ''),
  -- Null for work that belongs to no tenant.
  tenant_id uuid REFERENCES tenants (id),
  -- Identifiers only: never message text, a phone number or a name.
  payload jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(payload) = 'object'),
  run_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'dead')),
  -- Set exactly while a worker holds the job.
  locked_until timestamptz,
  -- A short code, never an error message.
  last_error text CHECK (last_error ~ '^[A-Za-z0-9_.-]{1,64}$'),
  CHECK ((state = 'running') = (locked_until IS NOT NULL))
);
CREATE INDEX jobs_due ON jobs (run_at) WHERE state = 'queued';
CREATE INDEX jobs_claimed ON jobs (locked_until) WHERE state = 'running';

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_insert ON jobs FOR INSERT TO psa_app
  WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY cross_tenant ON jobs FOR ALL TO psa_cross USING (true) WITH CHECK (true);
GRANT INSERT ON jobs TO psa_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON jobs TO psa_cross;

-- One row per worker process, so that something outside the worker can tell
-- whether one is alive. The worker accepts no HTTP (Gate 2 finding S18).
CREATE TABLE worker_heartbeats (
  worker_id text PRIMARY KEY CHECK (worker_id ~ '^[A-Za-z0-9_.-]{1,64}$'),
  started_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON worker_heartbeats TO psa_cross;

-- The processing lease: both null when no worker holds the conversation.
ALTER TABLE conversations
  ADD COLUMN lease_token uuid,
  ADD COLUMN lease_expires_at timestamptz,
  ADD CONSTRAINT conversations_lease_whole
    CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL));
