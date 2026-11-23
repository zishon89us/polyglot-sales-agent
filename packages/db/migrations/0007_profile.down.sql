-- Reverses 0007_profile.up.sql. Every tenant's services, policies and
-- settings are lost: a profile has to be loaded again. The rows a load
-- wrote to a tenant's audit log stay.
REVOKE SELECT (id, created_at, name, pack, time_zone, default_language),
       INSERT (id, created_at, name, pack, time_zone, default_language)
  ON tenants FROM psa_cross;
GRANT SELECT, INSERT ON tenants TO psa_cross;
REVOKE UPDATE (currency, support_contact, notification_email, business_hours, opening_hours,
               opening_hours_updated_at) ON tenants FROM psa_app;
ALTER TABLE tenants
  DROP COLUMN opening_hours_updated_at,
  DROP COLUMN opening_hours,
  DROP COLUMN business_hours,
  DROP COLUMN notification_email,
  DROP COLUMN support_contact,
  DROP COLUMN currency;
DROP TABLE policies;
DROP TABLE services;
