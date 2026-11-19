// The operator's commands (ADR 0011). Each writes two rows to the
// operator's record: one before it acts, one with how it ended.
//
// What a command prints holds nothing of any customer: no message text,
// no phone number, no contact's name. What it records holds no name at
// all, the tenant's included: a row it made is recorded by its identifier.

import type { Database } from "@polyglot-sales-agent/db";
import {
  createTenant,
  listDeadJobs,
  listTenants,
  readOperatorLog,
  recorded,
  retryDeadJob,
} from "@polyglot-sales-agent/db/operator";

/** The packs a tenant can be created on (data model, `tenants.pack`). */
export const PACKS = ["booking", "faq-only"] as const;

/** A fault in how the command was written. Its message is for the operator and holds no value they typed. */
export class UsageError extends Error {
  readonly code = "usage";
}

export const USAGE = `ops: the operator's commands. Each needs --as <your name>.

  ops tenant create --name <name> --pack <${PACKS.join("|")}> --time-zone <IANA zone> --language <tag> --as <name>
  ops tenant list --as <name>
  ops jobs list-dead --as <name>
  ops jobs retry <job id> --as <name>
  ops log show --as <name>

Every command is recorded in operator_log, before it acts and after.`;

export interface Output {
  readonly out: (line: string) => void;
}

interface Parsed {
  readonly words: readonly string[];
  readonly options: Readonly<Record<string, string>>;
}

/** Splits arguments into words and `--name value` options. Nothing is guessed: an option without a value, or given twice, is a fault. */
export function parse(argv: readonly string[]): Parsed {
  const words: string[] = [];
  const options: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] as string;
    if (!argument.startsWith("--")) {
      words.push(argument);
      continue;
    }
    const name = argument.slice(2);
    const value = argv[index + 1];
    if (!/^[a-z][a-z-]*$/.test(name)) {
      throw new UsageError("an option is not written as --name");
    }
    if (value === undefined || value.startsWith("--")) {
      throw new UsageError(`--${name} needs a value`);
    }
    if (Object.hasOwn(options, name)) {
      throw new UsageError(`--${name} is given twice`);
    }
    options[name] = value;
    index += 1;
  }
  return { words, options };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OPERATOR_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;
// A language tag: a language, then optionally a script and a region.
const LANGUAGE = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?$/;

function isTimeZone(zone: string): boolean {
  if (!/^[A-Za-z0-9_+-]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(zone) || zone.length > 64) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function only(parsed: Parsed, allowed: readonly string[], words: number): void {
  for (const name of Object.keys(parsed.options)) {
    if (!allowed.includes(name)) {
      throw new UsageError(`--${name} is not an option of this command`);
    }
  }
  if (parsed.words.length !== words) {
    throw new UsageError("the command has too many or too few words");
  }
}

function need(parsed: Parsed, name: string): string {
  const value = parsed.options[name];
  if (value === undefined || value.trim() === "") {
    throw new UsageError(`--${name} is needed`);
  }
  return value.trim();
}

/**
 * Runs one command. Returns when it is done; throws `UsageError` for a
 * command that is written wrongly, before anything is recorded or done,
 * and whatever the action threw otherwise, after its failure is recorded.
 */
export async function run(cross: Database, argv: readonly string[], output: Output): Promise<void> {
  const parsed = parse(argv);
  const name = `${parsed.words[0] ?? ""} ${parsed.words[1] ?? ""}`.trim();
  const operatorName = need(parsed, "as");
  if (!OPERATOR_NAME.test(operatorName)) {
    throw new UsageError(
      "--as takes a name of letters, digits, spaces, dots, hyphens and underscores, at most 64",
    );
  }

  if (name === "tenant create") {
    only(parsed, ["as", "name", "pack", "time-zone", "language"], 2);
    const tenant = {
      name: need(parsed, "name"),
      pack: need(parsed, "pack"),
      timeZone: need(parsed, "time-zone"),
      defaultLanguage: need(parsed, "language"),
    };
    if ([...tenant.name].length > 100) {
      throw new UsageError("--name is at most 100 characters");
    }
    if (!(PACKS as readonly string[]).includes(tenant.pack)) {
      throw new UsageError(`--pack is one of: ${PACKS.join(", ")}`);
    }
    if (!isTimeZone(tenant.timeZone)) {
      throw new UsageError("--time-zone is an IANA time zone, such as Asia/Riyadh");
    }
    if (!LANGUAGE.test(tenant.defaultLanguage)) {
      throw new UsageError("--language is a language tag, such as ar or en-GB");
    }
    // The tenant's name is not recorded: it can be a person's. The row is, by its identifier.
    const id = await recorded(
      cross,
      {
        command: name,
        operatorName,
        arguments: {
          pack: tenant.pack,
          timeZone: tenant.timeZone,
          language: tenant.defaultLanguage,
        },
      },
      async () => {
        const made = await createTenant(cross, tenant);
        return { value: made, subjectId: made };
      },
    );
    output.out(`tenant created: ${id}`);
    return;
  }

  if (name === "tenant list") {
    only(parsed, ["as"], 2);
    const tenants = await recorded(
      cross,
      { command: name, operatorName, arguments: {} },
      async () => ({
        value: await listTenants(cross),
      }),
    );
    output.out(`${tenants.length} tenant${tenants.length === 1 ? "" : "s"}`);
    for (const tenant of tenants) {
      output.out(
        [
          tenant.id,
          tenant.createdAt.toISOString(),
          tenant.pack,
          tenant.timeZone,
          tenant.defaultLanguage,
          JSON.stringify(tenant.name),
        ].join("  "),
      );
    }
    return;
  }

  if (name === "jobs list-dead") {
    only(parsed, ["as"], 2);
    const jobs = await recorded(
      cross,
      { command: name, operatorName, arguments: {} },
      async () => ({
        value: await listDeadJobs(cross),
      }),
    );
    output.out(`${jobs.length} dead job${jobs.length === 1 ? "" : "s"} (the oldest 100 at most)`);
    for (const job of jobs) {
      output.out(
        [
          job.id,
          job.createdAt.toISOString(),
          job.type,
          `tenant ${job.tenantId ?? "-"}`,
          `runs ${job.attempts}`,
          job.lastError ?? "-",
        ].join("  "),
      );
    }
    return;
  }

  if (name === "jobs retry") {
    only(parsed, ["as"], 3);
    const jobId = parsed.words[2] as string;
    if (!UUID.test(jobId)) {
      throw new UsageError("the job's identifier is not one");
    }
    const type = await recorded(
      cross,
      { command: name, operatorName, arguments: { jobId } },
      async () => {
        const retried = await retryDeadJob(cross, jobId);
        if (retried === undefined) {
          throw Object.assign(new Error("ops: there is no dead job with that identifier"), {
            code: "no-dead-job",
          });
        }
        return { value: retried, subjectId: jobId };
      },
    );
    output.out(`job queued again: ${jobId} (${type})`);
    return;
  }

  if (name === "log show") {
    only(parsed, ["as"], 2);
    const rows = await recorded(
      cross,
      { command: name, operatorName, arguments: {} },
      async () => ({
        value: await readOperatorLog(cross),
      }),
    );
    output.out(`the newest ${rows.length} rows of the record`);
    for (const row of rows) {
      output.out(
        [
          row.at.toISOString(),
          row.invocationId,
          row.phase,
          JSON.stringify(row.command),
          `as ${JSON.stringify(row.operatorName)}`,
          JSON.stringify(row.arguments),
          row.outcome ?? "-",
          row.subjectId ?? "-",
        ].join("  "),
      );
    }
    return;
  }

  throw new UsageError("there is no such command");
}
