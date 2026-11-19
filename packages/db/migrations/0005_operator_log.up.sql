-- The record of what the operator did through `ops` (ADR 0011; M2 unit U9).
-- Two rows for each command: one before it acts, one with how it ended.
-- Nothing is ever changed or removed.

-- True for an object of at most ten entries whose keys are plain words and
-- whose values are short strings of letters, digits, `_`, `-`, `/` and `.`.
-- That admits an identifier, a pack's name, a time zone and a language
-- tag, and nothing with a space or an `@` in it.
CREATE FUNCTION operator_arguments_ok(arguments jsonb) RETURNS boolean
  LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(arguments) = 'object'
     AND (SELECT count(*) FROM jsonb_object_keys(arguments)) <= 10
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_each(arguments) AS entry
       WHERE entry.key !~ '^[a-zA-Z][a-zA-Z0-9]{0,39}$'
          OR jsonb_typeof(entry.value) <> 'string'
          OR (entry.value #>> '{}') !~ '^[A-Za-z0-9_./-]{1,64}$'
     )
$$;
REVOKE ALL ON FUNCTION operator_arguments_ok(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION operator_arguments_ok(jsonb) TO psa_cross;

CREATE TABLE operator_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- The same in a command's two rows.
  invocation_id uuid NOT NULL,
  phase text NOT NULL CHECK (phase IN ('started', 'finished')),
  -- Words of lower-case letters and hyphens, such as `tenant create`.
  command text NOT NULL CHECK (command ~ '^[a-z][a-z-]{0,19}( [a-z][a-z-]{0,19}){0,2}$'),
  -- The name the operator gave with `--as`. A claim, not proof.
  operator_name text NOT NULL CHECK (operator_name ~ '^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$'),
  -- Identifiers and short settings only: never a name, an address or a
  -- number of anyone. At most ten keys, each value a short plain word.
  arguments jsonb NOT NULL DEFAULT '{}' CHECK (operator_arguments_ok(arguments)),
  -- For a finished row: `ok`, or a short code of what went wrong.
  outcome text CHECK (outcome ~ '^[A-Za-z0-9_-]{1,40}$'),
  -- For a finished row: the row the command made or changed, if any.
  subject_id uuid,
  CHECK ((phase = 'finished') = (outcome IS NOT NULL)),
  CHECK (phase = 'finished' OR subject_id IS NULL),
  UNIQUE (invocation_id, phase)
);
CREATE INDEX operator_log_at ON operator_log (at);

-- The table is the operator's own and belongs to no tenant. Only the
-- cross-tenant role, which `ops` connects as, may add to it and read it.
-- The application role, which serves requests from the internet, gets
-- nothing: it has no reason to write an operator's record.
GRANT SELECT, INSERT ON operator_log TO psa_cross;

-- Insert-only for every role, the owner included: a privilege can be
-- granted by mistake, a trigger says no all the same.
CREATE FUNCTION operator_log_is_insert_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'operator_log is insert-only' USING ERRCODE = 'insufficient_privilege';
END $$;
REVOKE ALL ON FUNCTION operator_log_is_insert_only() FROM PUBLIC;
CREATE TRIGGER operator_log_no_change BEFORE UPDATE OR DELETE ON operator_log
  FOR EACH ROW EXECUTE FUNCTION operator_log_is_insert_only();
CREATE TRIGGER operator_log_no_truncate BEFORE TRUNCATE ON operator_log
  FOR EACH STATEMENT EXECUTE FUNCTION operator_log_is_insert_only();
