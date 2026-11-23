// A tenant's profile in the database (M3 unit U3; design note
// docs/design/notes/m3-u3-profile.md). Everything here runs as the
// application role inside one tenant's scope: the cross-tenant role has no
// privilege on these tables.

import {
  type Answering,
  assembleBusinessProfile,
  type BusinessProfile,
  type ProfileFile,
  type ProfileRow,
  REQUIRED_SETTINGS,
} from "@polyglot-sales-agent/core";
import { type Database, poolOf } from "./connect.ts";
import { type Tx, withTenant } from "./tenant.ts";

function noTenant(where: string): Error {
  return Object.assign(new Error(`${where}: no such tenant`), { code: "tenant-not-found" });
}

// One statement, so that a profile is wholly the one before a load or
// wholly the one after it. It names `tenants`, `services` and `policies`
// and no other table: nothing of a contact can be in what it returns.
const PROFILE = `
  SELECT t.name, t.time_zone, t.currency, t.support_contact, t.opening_hours,
         coalesce((SELECT jsonb_agg(jsonb_build_object(
                            'id', s.id, 'name', s.name, 'description', s.description,
                            'price_minor', s.price_minor::text)
                          ORDER BY lower(s.name), s.id)
                   FROM services s WHERE s.tenant_id = t.id AND s.active), '[]') AS services,
         coalesce((SELECT jsonb_agg(jsonb_build_object(
                            'id', p.id, 'title', p.title, 'body', p.body)
                          ORDER BY lower(p.title), p.id)
                   FROM policies p WHERE p.tenant_id = t.id), '[]') AS policies
  FROM tenants t WHERE t.id = $1`;

/** The profile inside a transaction that is already in the tenant's scope. */
export async function readBusinessProfile(tx: Tx, tenantId: string): Promise<BusinessProfile> {
  const found = await tx.query<ProfileRow>(PROFILE, [tenantId]);
  const row = found.rows[0];
  if (row === undefined) {
    throw noTenant("readBusinessProfile");
  }
  return assembleBusinessProfile(row);
}

/**
 * What the model is given about a business (design note, section 2). It
 * takes a tenant and nothing of a contact, a conversation or a session.
 */
export function loadBusinessProfile(app: Database, tenantId: string): Promise<BusinessProfile> {
  return withTenant(poolOf(app), tenantId, (tx) => readBusinessProfile(tx, tenantId));
}

/** What a tenant still lacks to answer (design note, section 4). */
export function answering(app: Database, tenantId: string): Promise<Answering> {
  return withTenant(poolOf(app), tenantId, async (tx) => {
    const found = await tx.query<Record<string, boolean>>(
      `SELECT ${REQUIRED_SETTINGS.map((name) => `t.${name} IS NULL AS ${name}`).join(", ")},
              EXISTS (SELECT 1 FROM channel_accounts a WHERE a.tenant_id = t.id) AS connected
       FROM tenants t WHERE t.id = $1`,
      [tenantId],
    );
    const row = found.rows[0];
    if (row === undefined) {
      throw noTenant("answering");
    }
    return {
      settingsMissing: REQUIRED_SETTINGS.filter((name) => row[name] === true),
      channelConnected: row["connected"] === true,
    };
  });
}

/** How many items a load added, changed and removed. */
export interface ProfileChange {
  readonly services: { readonly added: number; readonly changed: number; readonly removed: number };
  readonly policies: { readonly added: number; readonly changed: number; readonly removed: number };
}

/**
 * Makes the tenant's profile what the file says, in one transaction that
 * first locks the tenant's row, so that two loads go one after the other
 * (design note, L1 to L4, L9). An item whose values are as stored is not
 * touched. An item the file does not name is deleted. One row is written to
 * the tenant's audit log, with `details` as given and the counts.
 *
 * The file must already have passed `readProfileFile`.
 */
export function replaceProfile(
  app: Database,
  tenantId: string,
  file: ProfileFile,
  details: Readonly<Record<string, string>>,
): Promise<ProfileChange> {
  return withTenant(poolOf(app), tenantId, async (tx) => {
    const locked = await tx.query("SELECT 1 FROM tenants WHERE id = $1 FOR NO KEY UPDATE", [
      tenantId,
    ]);
    if (locked.rowCount === 0) {
      throw noTenant("replaceProfile");
    }
    const opening =
      file.settings.openingHours === null ? null : JSON.stringify(file.settings.openingHours);
    await tx.query(
      `UPDATE tenants
       SET currency = $2, support_contact = $3, notification_email = $4,
           business_hours = $5::jsonb,
           opening_hours_updated_at = CASE WHEN opening_hours IS DISTINCT FROM $6::jsonb
                                           THEN clock_timestamp() ELSE opening_hours_updated_at END,
           opening_hours = $6::jsonb
       WHERE id = $1`,
      [
        tenantId,
        file.settings.currency,
        file.settings.supportContact,
        file.settings.notificationEmail,
        JSON.stringify(file.settings.businessHours),
        opening,
      ],
    );

    const services = { added: 0, changed: 0, removed: 0 };
    for (const service of file.services) {
      const values = [service.name, service.description, service.priceMinor, service.active];
      const existing = await tx.query("SELECT 1 FROM services WHERE lower(name) = lower($1)", [
        service.name,
      ]);
      if (existing.rowCount === 0) {
        await tx.query(
          `INSERT INTO services (tenant_id, name, description, price_minor, active)
           VALUES ($5, $1, $2, $3, $4)`,
          [...values, tenantId],
        );
        services.added += 1;
      } else {
        const changed = await tx.query(
          `UPDATE services
           SET name = $1, description = $2, price_minor = $3, active = $4,
               updated_at = clock_timestamp()
           WHERE lower(name) = lower($1)
             AND (name, description, price_minor, active) IS DISTINCT FROM ($1, $2, $3::bigint, $4)`,
          values,
        );
        services.changed += changed.rowCount;
      }
    }
    const gone = await tx.query(
      `DELETE FROM services
       WHERE lower(name) <> ALL (SELECT lower(given) FROM unnest($1::text[]) AS given)`,
      [file.services.map((service) => service.name)],
    );
    services.removed = gone.rowCount;

    const policies = { added: 0, changed: 0, removed: 0 };
    for (const policy of file.policies) {
      const existing = await tx.query("SELECT 1 FROM policies WHERE lower(title) = lower($1)", [
        policy.title,
      ]);
      if (existing.rowCount === 0) {
        await tx.query("INSERT INTO policies (tenant_id, title, body) VALUES ($3, $1, $2)", [
          policy.title,
          policy.body,
          tenantId,
        ]);
        policies.added += 1;
      } else {
        const changed = await tx.query(
          `UPDATE policies SET title = $1, body = $2, updated_at = clock_timestamp()
           WHERE lower(title) = lower($1) AND (title, body) IS DISTINCT FROM ($1, $2)`,
          [policy.title, policy.body],
        );
        policies.changed += changed.rowCount;
      }
    }
    const dropped = await tx.query(
      `DELETE FROM policies
       WHERE lower(title) <> ALL (SELECT lower(given) FROM unnest($1::text[]) AS given)`,
      [file.policies.map((policy) => policy.title)],
    );
    policies.removed = dropped.rowCount;

    // For the owner to see, from the day there is a screen to see it on.
    await tx.query(
      `INSERT INTO audit_log (tenant_id, action, subject_type, subject_id, details)
       VALUES ($1, 'profile.loaded', 'tenant', $1, $2::jsonb)`,
      [
        tenantId,
        JSON.stringify({
          ...details,
          servicesAdded: services.added,
          servicesChanged: services.changed,
          servicesRemoved: services.removed,
          policiesAdded: policies.added,
          policiesChanged: policies.changed,
          policiesRemoved: policies.removed,
        }),
      ],
    );
    return { services, policies };
  });
}
