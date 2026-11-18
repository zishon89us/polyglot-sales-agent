-- Reverses 0002_jobs_and_lease.up.sql. Every job is lost: queued, running
-- and dead. Held leases are lost with their columns.
ALTER TABLE conversations
  DROP CONSTRAINT conversations_lease_whole,
  DROP COLUMN lease_expires_at,
  DROP COLUMN lease_token;
DROP TABLE worker_heartbeats;
DROP TABLE jobs;
DROP FUNCTION job_payload_ok(jsonb);
