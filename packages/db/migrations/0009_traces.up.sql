-- One row for every call to the model (US-C10; M3 unit U6; design note
-- docs/design/notes/m3-u6-traces.md, sections 3 and 4).
--
-- No column holds free text. Each text column has a pattern, so that a
-- later change that put a sentence in one would be refused here. The
-- client checks the same patterns before a call is made
-- (packages/core/src/trace.ts): a row this table refuses is a call that
-- was paid for and left no record.
CREATE TABLE ai_traces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  session_id uuid NOT NULL,
  -- One identifier for all the calls of a turn. Made each time the turn's
  -- job runs; there is no table of turns.
  turn_id uuid NOT NULL,
  -- When the turn began, as its caller gave it.
  turn_started_at timestamptz NOT NULL,
  -- When the adapter was called, and how long until it answered, failed
  -- or ran out of time.
  started_at timestamptz NOT NULL,
  latency_ms integer NOT NULL CHECK (latency_ms >= 0),
  -- The prompts the request was assembled from, in order.
  prompt_names text[] NOT NULL
    -- No element holds the separator, so the joined text has one name
    -- for each element.
    CHECK (array_to_string(prompt_names, '', '?') !~ '[^a-z0-9-]'
           AND array_to_string(prompt_names, ',', '?')
               ~ '^[a-z][a-z0-9-]{0,39}(,[a-z][a-z0-9-]{0,39}){0,7}$'),
  prompt_versions integer[] NOT NULL
    CHECK (array_position(prompt_versions, NULL) IS NULL
           AND 1 <= ALL (prompt_versions) AND 9999 >= ALL (prompt_versions)),
  -- The model's name as the adapter gave it; 'other' for a name that does
  -- not fit the pattern. Null when the call gave no answer.
  model text CHECK (model ~ '^[A-Za-z0-9._:/-]{1,200}$'),
  input_tokens bigint CHECK (input_tokens >= 0),
  output_tokens bigint CHECK (output_tokens >= 0),
  -- Millionths of a US dollar: an estimate from the two counts and the
  -- two prices beside it, rounded up. Null is "unknown", which is not 0.
  cost_micros bigint CHECK (cost_micros BETWEEN 0 AND 2000000000000),
  -- Millionths of a US dollar for a million tokens.
  price_input bigint CHECK (price_input BETWEEN 0 AND 1000000000),
  price_output bigint CHECK (price_output BETWEEN 0 AND 1000000000),
  -- The tools an answer asked for, by name, in order, repeats kept.
  tool_names text[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(tool_names) = 0
           OR (array_to_string(tool_names, '', '?') !~ '[^a-z0-9_-]'
               AND array_to_string(tool_names, ',', '?')
                   ~ '^[a-z][a-z0-9_-]{0,63}(,[a-z][a-z0-9_-]{0,63}){0,3}$')),
  outcome text NOT NULL,
  outcome_code text,
  CONSTRAINT ai_traces_one_dimension
    CHECK (array_ndims(prompt_names) = 1 AND array_ndims(prompt_versions) = 1
           AND coalesce(array_ndims(tool_names), 1) = 1),
  CONSTRAINT ai_traces_prompts_pair
    CHECK (cardinality(prompt_names) = cardinality(prompt_versions)),
  CONSTRAINT ai_traces_outcome
    CHECK ((outcome IN ('ok', 'timeout', 'fault') AND outcome_code IS NULL)
        -- "IS NOT NULL" is said: a null code would pass a bare IN.
        OR (outcome = 'invalid-output' AND outcome_code IS NOT NULL
            AND outcome_code IN ('shape', 'flag', 'claim', 'tool-call', 'truncated'))
        OR (outcome = 'provider-error' AND outcome_code IS NOT NULL
            AND outcome_code IN ('unavailable', 'rate-limited', 'refused', 'bad-request',
                                 'not-authorised', 'other'))),
  -- A call that gave an answer has a model and both counts; one that did
  -- not has none of the three.
  CONSTRAINT ai_traces_answered
    CHECK ((model IS NOT NULL) = (outcome IN ('ok', 'invalid-output'))
       AND (input_tokens IS NOT NULL) = (model IS NOT NULL)
       AND (output_tokens IS NOT NULL) = (model IS NOT NULL)),
  -- A cost has the two prices it was worked out from, and an answer.
  CONSTRAINT ai_traces_costed
    CHECK ((price_input IS NOT NULL) = (cost_micros IS NOT NULL)
       AND (price_output IS NOT NULL) = (cost_micros IS NOT NULL)
       AND (cost_micros IS NULL OR (model IS NOT NULL AND model <> 'other'))),
  CONSTRAINT ai_traces_tools_only_when_ok
    CHECK (outcome = 'ok' OR cardinality(tool_names) = 0),
  FOREIGN KEY (tenant_id, session_id) REFERENCES sessions (tenant_id, id)
);

CREATE INDEX ai_traces_session ON ai_traces (tenant_id, session_id, started_at);
CREATE INDEX ai_traces_turn ON ai_traces (tenant_id, turn_id);

ALTER TABLE ai_traces ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_traces FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_traces FOR ALL TO psa_app
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
-- A trace is written once and read. It is not changed and not removed by
-- the application.
GRANT SELECT, INSERT ON ai_traces TO psa_app;
