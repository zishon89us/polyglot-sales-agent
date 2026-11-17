-- Reverses 0001_core_tables.up.sql. Dropping a table drops its policies,
-- its privileges and its triggers.
DROP TABLE audit_log;
DROP TABLE messages;
DROP TABLE conversations;
DROP TABLE contacts;
DROP TABLE channel_routes;
DROP TABLE channel_accounts;
DROP FUNCTION channel_routes_sync();
DROP TABLE tenants;
DROP FUNCTION app_tenant_id();
