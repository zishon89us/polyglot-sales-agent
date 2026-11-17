// The three database roles (ADR 0003, issue #162). Their names are fixed
// because the migrations grant privileges to them by name.

/** Owns the schema and runs migrations. Row-level security applies to it too; it has no policy. */
export const MIGRATE_ROLE = "psa_migrate";
/** What the application connects as. Sees only the rows of the transaction's tenant. */
export const APP_ROLE = "psa_app";
/** For the few lookups and jobs that cross tenants by design. */
export const CROSS_ROLE = "psa_cross";

export const ROLES = [MIGRATE_ROLE, APP_ROLE, CROSS_ROLE] as const;
export type Role = (typeof ROLES)[number];

/** Tables in the public schema that deliberately have no tenant policy, each with the reason. */
export const UNSCOPED_TABLES: Readonly<Record<string, string>> = {
  channel_routes: "read to find the tenant of a webhook, before a tenant is known",
  schema_migrations: "the migration runner's own record",
};

/**
 * Functions that run with their owner's rights, by signature, each with the reason. Such a
 * function is not subject to the caller's privileges, so each one is a
 * deliberate exception.
 */
export const DEFINER_FUNCTIONS: Readonly<Record<string, string>> = {
  "channel_routes_sync()": "the trigger that keeps channel_routes equal to channel_accounts",
};
