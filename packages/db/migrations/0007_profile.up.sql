-- What a business says about itself: its services, its policies and the
-- settings a tenant needs before it answers (M3 unit U3; design note
-- docs/design/notes/m3-u3-profile.md).
--
-- Lengths are counted in characters (code points), and are the API
-- design's. The rules that need more than a length (which characters a
-- text may hold, the shape of hours, the list of currencies, how many
-- items a profile may have) are the loader's, in packages/core.

CREATE TABLE services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  -- Written by the owner. Data, never an instruction.
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  -- In the smallest unit of the tenant's currency.
  price_minor bigint NOT NULL CHECK (price_minor >= 0),
  -- One that is not active is kept and is not given to the model.
  active boolean NOT NULL DEFAULT true,
  -- When a value of this row last changed.
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- So that a pack's rows can point at a service of the same tenant.
  UNIQUE (tenant_id, id)
);
-- A file names a service by its name: two of a tenant may not differ only in case.
CREATE UNIQUE INDEX services_name ON services (tenant_id, lower(name));

CREATE TABLE policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  -- Written by the owner. Data, never an instruction.
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX policies_title ON policies (tenant_id, lower(title));

-- All null until a profile is loaded.
ALTER TABLE tenants
  ADD COLUMN currency text CHECK (currency ~ '^[A-Z]{3}$'),
  -- How a customer reaches the business: a phone number or an email address.
  ADD COLUMN support_contact text CHECK (char_length(support_contact) BETWEEN 1 AND 254),
  -- Where the business's own notices go. Nothing is sent to it yet.
  ADD COLUMN notification_email text CHECK (char_length(notification_email) BETWEEN 3 AND 254),
  -- When the business's people answer, and when the business is open: a
  -- list of periods, each a weekday (1 is Monday) with the times it opens
  -- and closes, in the tenant's time zone.
  ADD COLUMN business_hours jsonb CHECK (jsonb_typeof(business_hours) = 'array'),
  ADD COLUMN opening_hours jsonb CHECK (jsonb_typeof(opening_hours) = 'array'),
  ADD COLUMN opening_hours_updated_at timestamptz;

ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE services FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON services FOR ALL TO psa_app
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY cross_tenant ON services FOR ALL TO psa_cross USING (true) WITH CHECK (true);

ALTER TABLE policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE policies FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON policies FOR ALL TO psa_app
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY cross_tenant ON policies FOR ALL TO psa_cross USING (true) WITH CHECK (true);

-- The application role, inside one tenant's scope, reads and writes that
-- tenant's profile. The cross-tenant role is granted nothing here: a
-- policy grants nothing without a table privilege, so it cannot read or
-- write any tenant's services, policies or settings.
GRANT SELECT, INSERT, UPDATE, DELETE ON services, policies TO psa_app;
GRANT UPDATE (currency, support_contact, notification_email, business_hours, opening_hours,
              opening_hours_updated_at) ON tenants TO psa_app;
