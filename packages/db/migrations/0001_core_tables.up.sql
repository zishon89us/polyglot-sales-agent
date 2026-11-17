-- The tables the walking skeleton needs, each with tenant isolation by
-- row-level security (ADR 0003). The tables carry only the columns the
-- skeleton uses; the rest of `docs/design/data-model.md` arrives with the
-- unit that uses it.
--
-- Run by the migration role, which owns everything created here. The roles
-- psa_app and psa_cross are created by the bootstrap step, not here.

-- The tenant of the current transaction, or null when none is set.
-- After a transaction that set it ends, the setting reads as an empty
-- string on the same connection, not as null; hence nullif.
CREATE FUNCTION app_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE
  RETURN nullif(current_setting('app.tenant_id', true), '')::uuid;

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL CHECK (name <> ''),
  pack text NOT NULL CHECK (pack <> ''),
  time_zone text NOT NULL CHECK (time_zone <> ''),
  default_language text NOT NULL CHECK (default_language <> '')
);

CREATE TABLE channel_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'mock')),
  receiving_number_id text NOT NULL UNIQUE CHECK (receiving_number_id <> ''),
  UNIQUE (tenant_id, id)
);

-- Read before a tenant is known, so it has no row-level security. The
-- application and cross-tenant roles cannot write it; the trigger below
-- keeps it equal to channel_accounts.
CREATE TABLE channel_routes (
  receiving_number_id text PRIMARY KEY
    REFERENCES channel_accounts (receiving_number_id) ON UPDATE CASCADE ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants (id)
);

CREATE FUNCTION channel_routes_sync() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.channel_routes (receiving_number_id, tenant_id)
    VALUES (NEW.receiving_number_id, NEW.tenant_id);
  ELSE
    -- A changed number arrives through the foreign key's cascade.
    UPDATE public.channel_routes SET tenant_id = NEW.tenant_id
    WHERE receiving_number_id = NEW.receiving_number_id;
  END IF;
  RETURN NULL;
END;
$$;
-- No role needs to call it: a trigger runs its function without that right.
REVOKE ALL ON FUNCTION channel_routes_sync() FROM PUBLIC;

CREATE TRIGGER channel_accounts_route
  AFTER INSERT OR UPDATE OF receiving_number_id, tenant_id ON channel_accounts
  FOR EACH ROW EXECUTE FUNCTION channel_routes_sync();

CREATE TABLE contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- E.164. Null after deletion or retention.
  phone text CHECK (phone ~ '^\+[1-9][0-9]{1,14}$'),
  UNIQUE (tenant_id, phone),
  UNIQUE (tenant_id, id)
);

-- The foreign keys below include tenant_id on purpose. A foreign-key check
-- is not subject to row-level security, so without it a row could point at
-- another tenant's row.
CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  contact_id uuid NOT NULL,
  channel_account_id uuid NOT NULL,
  -- One conversation per contact. The tenant is part of the key so that the
  -- constraint never answers a question about another tenant's rows.
  UNIQUE (tenant_id, contact_id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, contact_id) REFERENCES contacts (tenant_id, id),
  FOREIGN KEY (tenant_id, channel_account_id) REFERENCES channel_accounts (tenant_id, id)
);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  conversation_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  class text CHECK (class IN (
    'assistant-reply', 'system-reply', 'staff-message', 'service-notice', 'business-initiated'
  )),
  kind text NOT NULL CHECK (kind <> ''),
  channel_message_id text,
  body text,
  status text CHECK (status IN (
    'pending', 'held', 'discarded', 'withheld', 'sending', 'sent', 'delivered', 'read', 'failed'
  )),
  -- Only an outbound message has a class and a status.
  CHECK ((direction = 'outbound') = (class IS NOT NULL)),
  CHECK ((direction = 'outbound') = (status IS NOT NULL)),
  -- The deduplication of US-C1: one row per channel message per tenant.
  UNIQUE (tenant_id, channel_message_id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES conversations (tenant_id, id)
);

CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  action text NOT NULL CHECK (action <> ''),
  subject_type text NOT NULL CHECK (subject_type <> ''),
  subject_id uuid,
  details jsonb NOT NULL DEFAULT '{}'
);

-- Row-level security. FORCE applies it to the owner too, so the migration
-- role, which has no policy, reads no rows. One policy admits the
-- application role to its transaction's tenant; one admits the cross-tenant
-- role to every row. A policy grants nothing without a table privilege.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants FOR ALL TO psa_app
  USING (id = app_tenant_id()) WITH CHECK (id = app_tenant_id());
CREATE POLICY cross_tenant ON tenants FOR ALL TO psa_cross USING (true) WITH CHECK (true);

ALTER TABLE channel_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON channel_accounts FOR ALL TO psa_app
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY cross_tenant ON channel_accounts FOR ALL TO psa_cross USING (true) WITH CHECK (true);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON contacts FOR ALL TO psa_app
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY cross_tenant ON contacts FOR ALL TO psa_cross USING (true) WITH CHECK (true);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON conversations FOR ALL TO psa_app
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY cross_tenant ON conversations FOR ALL TO psa_cross USING (true) WITH CHECK (true);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON messages FOR ALL TO psa_app
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY cross_tenant ON messages FOR ALL TO psa_cross USING (true) WITH CHECK (true);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_log FOR ALL TO psa_app
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY cross_tenant ON audit_log FOR ALL TO psa_cross USING (true) WITH CHECK (true);

-- Privileges: only what the skeleton uses. Nothing is left to PUBLIC.
-- The application role cannot create a tenant or a channel account, cannot
-- delete anything yet, and can only add to the audit log.
REVOKE ALL ON FUNCTION app_tenant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_tenant_id() TO psa_app, psa_cross;
GRANT SELECT ON tenants, channel_accounts TO psa_app;
GRANT SELECT, INSERT, UPDATE ON contacts, conversations, messages TO psa_app;
GRANT SELECT, INSERT ON audit_log TO psa_app;

GRANT SELECT, INSERT ON tenants, channel_accounts TO psa_cross;
GRANT SELECT ON channel_routes TO psa_cross;
