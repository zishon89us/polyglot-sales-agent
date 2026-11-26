-- The handover record (M3 unit U11; design note
-- docs/design/notes/m3-u11-handover.md). A request for a person's
-- attention about one contact. In M3 no person can answer: what is here is
-- the record, the assistant's silence while it lasts, and the message
-- that says so. The columns for staff, the clock and the follow-up are
-- M4's, added with the code that fills them.

CREATE TABLE handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  contact_id uuid NOT NULL,
  -- Attached to a session exactly while waiting or in progress (H3).
  session_id uuid,
  state text NOT NULL CHECK (state IN (
    'waiting', 'in-progress', 'detached', 'followed-up',
    'handed-back', 'answered', 'closed-unanswered')),
  -- Why, in the order the reasons first came; no reason twice. The names
  -- are the core's list (`HANDOVER_REASONS`); the table holds their shape.
  reasons text[] NOT NULL CHECK (
    cardinality(reasons) BETWEEN 1 AND 10 AND array_position(reasons, NULL) IS NULL),
  -- Set when the reason `emergency` is added; never cleared.
  urgent boolean NOT NULL DEFAULT false,
  attached_at timestamptz,
  detached_at timestamptz,
  closed_reason text CHECK (closed_reason ~ '^[a-z][a-z-]{0,39}$'),
  ended_at timestamptz,
  FOREIGN KEY (tenant_id, contact_id) REFERENCES contacts (tenant_id, id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES sessions (tenant_id, id),
  UNIQUE (tenant_id, id),
  CONSTRAINT handovers_attached_exactly_when_waiting_or_in_progress
    CHECK ((session_id IS NOT NULL) = (state IN ('waiting', 'in-progress'))),
  CONSTRAINT handovers_urgent_has_its_reason
    CHECK (NOT urgent OR 'emergency' = ANY (reasons)),
  CONSTRAINT handovers_closed_has_its_end
    CHECK ((state IN ('handed-back', 'answered', 'closed-unanswered')) = (ended_at IS NOT NULL))
);
-- No reason twice, and each of a name's shape. An index cannot say that; a function in a check can.
CREATE FUNCTION handover_reasons_ok(reasons text[]) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  RETURN (SELECT count(DISTINCT reason) = cardinality(reasons)
                 AND bool_and(reason ~ '^[a-z][a-z-]{0,39}$')
          FROM unnest(reasons) AS reason);
REVOKE ALL ON FUNCTION handover_reasons_ok(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION handover_reasons_ok(text[]) TO psa_app, psa_cross;
ALTER TABLE handovers
  ADD CONSTRAINT handovers_no_reason_twice CHECK (handover_reasons_ok(reasons));

-- One open handover for a contact (H1), kept by the table itself.
CREATE UNIQUE INDEX handovers_one_open_for_a_contact ON handovers (tenant_id, contact_id)
  WHERE state IN ('waiting', 'in-progress', 'detached', 'followed-up');
CREATE INDEX handovers_session ON handovers (session_id) WHERE session_id IS NOT NULL;

ALTER TABLE handovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE handovers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON handovers FOR ALL TO psa_app
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT, INSERT, UPDATE ON handovers TO psa_app;

-- A message of ours that tells the customer of a handover: which one, and
-- which text it is.
ALTER TABLE messages
  ADD COLUMN handover_id uuid,
  ADD COLUMN tells text CHECK (tells IN ('handover', 'emergency')),
  ADD CONSTRAINT messages_handover FOREIGN KEY (tenant_id, handover_id)
    REFERENCES handovers (tenant_id, id),
  ADD CONSTRAINT messages_telling_is_a_system_reply
    CHECK ((handover_id IS NULL AND tells IS NULL)
        OR (handover_id IS NOT NULL AND tells IS NOT NULL
            AND direction = 'outbound' AND class = 'system-reply'));

-- The answer matched the schema and a trigger handed the session over, so
-- no other check ran.
ALTER TABLE reply_checks
  DROP CONSTRAINT reply_checks_outcome_check,
  ADD CONSTRAINT reply_checks_outcome_check
    CHECK (outcome IN ('passed', 'blocked', 'error', 'handed-over'));
