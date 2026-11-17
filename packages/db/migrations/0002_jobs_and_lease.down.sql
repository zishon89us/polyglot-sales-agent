-- Reverses 0002_jobs_and_lease.up.sql. Queued jobs are lost.
ALTER TABLE conversations
  DROP CONSTRAINT conversations_lease_whole,
  DROP COLUMN lease_expires_at,
  DROP COLUMN lease_token;
DROP TABLE worker_heartbeats;
DROP TABLE jobs;
