-- The job queue, the conversation lease and the worker heartbeat (ADR 0004).

-- True if a job payload holds identifiers only: at most 20 keys, each of
-- letters ending in `Id`, each value a UUID. The jobs table is read across tenants, so it must
-- never hold message text, a phone number or a name.
CREATE FUNCTION job_payload_ok(payload jsonb) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  RETURN jsonb_typeof(payload) = 'object'
    AND (SELECT count(*) FROM jsonb_object_keys(payload)) <= 20
    AND NOT EXISTS (
    SELECT 1 FROM jsonb_each(payload) AS entry
    WHERE entry.key !~ '^[a-z][A-Za-z]{0,37}Id$'
       OR jsonb_typeof(entry.value) <> 'string'
       OR (entry.value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );
REVOKE ALL ON FUNCTION job_payload_ok(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION job_payload_ok(jsonb) TO psa_app, psa_cross;

-- A job is claimed by a worker before its tenant is known, so the
-- cross-tenant role reads and changes every row. The application role works
-- inside one tenant: it may add a job, see which jobs of that tenant exist
-- (not what they hold), and cancel one that is still queued. That is what a
-- timer needs: created, replaced or cancelled in the transaction that
-- changes the state it belongs to.
--
-- A finished job is deleted. A job that has failed for the last time stays,
-- in state `dead`.
CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Letters and hyphens only, so a type cannot carry a number.
  type text NOT NULL CHECK (type ~ '^[a-z][a-z-]{0,39}$'),
  -- Null for work that belongs to no tenant.
  tenant_id uuid REFERENCES tenants (id),
  -- What the job is about (a conversation, later a booking or a handover),
  -- so that a timer can be found again and cancelled. Null when nothing
  -- will ever need to find it.
  subject_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'
    CHECK (job_payload_ok(payload)),
  run_at timestamptz NOT NULL CHECK (isfinite(run_at)),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'dead')),
  -- Set exactly while a worker holds the job.
  locked_until timestamptz,
  -- A short code, never an error message.
  last_error text CHECK (last_error ~ '^[A-Za-z0-9_-]{1,40}$'),
  CHECK ((state = 'running') = (locked_until IS NOT NULL))
);
CREATE INDEX jobs_due ON jobs (run_at) WHERE state = 'queued';
CREATE INDEX jobs_claimed ON jobs (locked_until) WHERE state = 'running';
CREATE INDEX jobs_subject ON jobs (tenant_id, type, subject_id)
  WHERE state = 'queued' AND subject_id IS NOT NULL;

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs FORCE ROW LEVEL SECURITY;
-- The alert type is the queue's own: no tenant's code may queue one. Nor
-- may it date a job into the past, which would put it ahead of every other
-- tenant's; a minute is allowed for a transaction that takes its time.
CREATE POLICY tenant_insert ON jobs FOR INSERT TO psa_app
  WITH CHECK (tenant_id = app_tenant_id() AND type <> 'operator-alert'
    AND run_at >= now() - interval '1 minute');
CREATE POLICY tenant_select ON jobs FOR SELECT TO psa_app
  USING (tenant_id = app_tenant_id());
CREATE POLICY tenant_cancel ON jobs FOR DELETE TO psa_app
  USING (tenant_id = app_tenant_id() AND state = 'queued');
CREATE POLICY cross_tenant ON jobs FOR ALL TO psa_cross USING (true) WITH CHECK (true);
-- By column: the application role cannot choose a job's id, state, attempts
-- or error, and cannot read a payload or an error.
GRANT INSERT (type, tenant_id, subject_id, payload, run_at) ON jobs TO psa_app;
GRANT SELECT (id, type, tenant_id, subject_id, state) ON jobs TO psa_app;
GRANT DELETE ON jobs TO psa_app;
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
