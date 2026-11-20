// The operator's commands (ADR 0011). Each writes two rows to the
// operator's record: one before it acts, one with how it ended.
//
// What a command prints holds nothing of any customer: no message text,
// no phone number, no contact's name. What it records holds no name at
// all, the tenant's included: a row it made is recorded by its identifier.
//
// A command is checked in full by `prepare` before a connection is made,
// so one that is written wrongly is refused with nothing recorded or done.

import type { Database } from "@polyglot-sales-agent/db";
import {
  connectChannel,
  createTenant,
  listDeadJobs,
  listTenants,
  readOperatorLog,
  recorded,
  retryDeadJob,
} from "@polyglot-sales-agent/db/operator";

/** The packs a tenant can be created on (data model, `tenants.pack`). */
export const PACKS = ["booking", "faq-only"] as const;

/** The channels a number can be connected on (data model, `channel_accounts.channel`). */
export const CHANNELS = ["whatsapp", "mock"] as const;

/** The most rows `log show` reads at once. */
export const LOG_LIMIT_MAX = 1_000;

/** A fault in how the command was written. Its message is for the operator and holds no value they typed. */
export class UsageError extends Error {
  readonly code = "usage";
}

/**
 * The command did what it was asked and printed its result, but the second
 * row of its record could not be written. Not a reason to run it again.
 */
export class RecordIncomplete extends Error {
  readonly code = "record-incomplete";
}

export const USAGE = `ops: the operator's commands. Each needs --as <your name>.

  ops tenant create --name <name> --pack <${PACKS.join("|")}> --time-zone <zone> --language <tag> --as <name>
  ops tenant list --as <name>
  ops channel connect --tenant <tenant id> --channel <${CHANNELS.join("|")}> --number-id <the channel's id of the number> --as <name>
  ops jobs list-dead --as <name>
  ops jobs retry <job id> --as <name>
  ops log show [--limit <1 to ${LOG_LIMIT_MAX}>] --as <name>

--as        your name: letters without accents, digits, spaces, dots, hyphens
            and underscores, at most 64. It is a claim, not proof.
--time-zone a named IANA zone, such as Asia/Riyadh. Zones written with a
            plus sign, such as Etc/GMT+5, are not taken.
channel connect
            connects a receiving number to a tenant, so that messages to it
            reach that tenant. --number-id is
            the channel's identifier for the number, digits only, not the
            phone number itself.
jobs retry  queues the job again with its retries restored. A job that sends
            messages will not send those that have waited over 15 minutes:
            they are marked as expired.

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
// What the record takes as an argument's value (`operator_arguments_ok`).
const RECORDABLE = /^[A-Za-z0-9_./-]{1,64}$/;
// Control and format characters, unassigned and private-use ones, and the line and paragraph
// separators: nothing a name is written with.
const UNPRINTABLE = /[\p{C}\p{Zl}\p{Zp}]/u;

/** The zone's name as the platform writes it, or undefined if it is not a zone the record can hold. */
function timeZone(zone: string): string | undefined {
  if (!RECORDABLE.test(zone)) {
    return undefined;
  }
  try {
    const canonical = new Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions().timeZone;
    return RECORDABLE.test(canonical) ? canonical : undefined;
  } catch {
    return undefined;
  }
}

/** A name for the screen: in quotes, with every character that could move the cursor or reorder the line written as a code. */
export function shown(name: string): string {
  return JSON.stringify(name).replace(
    /[\p{C}\p{Zl}\p{Zp}]/gu,
    (character) => `\\u{${(character.codePointAt(0) ?? 0).toString(16)}}`,
  );
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

/** A command that has been checked and is ready to run. */
export type Prepared = (cross: Database, output: Output) => Promise<void>;

/**
 * Checks a command in full, without a database, and returns it ready to
 * run. Throws `UsageError` for one that is written wrongly.
 *
 * The returned function throws whatever the action threw, after its failure
 * is recorded; and `RecordIncomplete`, after printing the result, if the
 * action was done and its second row could not be written.
 */
export function prepare(argv: readonly string[]): Prepared {
  const parsed = parse(argv);
  const command = `${parsed.words[0] ?? ""} ${parsed.words[1] ?? ""}`.trim();
  const operatorName = need(parsed, "as");
  if (!OPERATOR_NAME.test(operatorName)) {
    throw new UsageError(
      "--as takes a name of letters without accents, digits, spaces, dots, hyphens and underscores, at most 64",
    );
  }

  /** Runs the action with its record, prints with `print`, and says so if the record is left incomplete. */
  const ready =
    <T>(
      args: Readonly<Record<string, string>>,
      action: (cross: Database) => Promise<{ value: T; subjectId?: string }>,
      print: (value: T, output: Output) => void,
    ): Prepared =>
    async (cross, output) => {
      let incomplete = false;
      const value = await recorded(
        cross,
        { command, operatorName, arguments: args },
        () => action(cross),
        () => {
          incomplete = true;
        },
      );
      print(value, output);
      if (incomplete) {
        throw new RecordIncomplete(
          "ops: the command was done, but its second row could not be recorded; do not run it again",
        );
      }
    };

  if (command === "tenant create") {
    only(parsed, ["as", "name", "pack", "time-zone", "language"], 2);
    const name = need(parsed, "name");
    const pack = need(parsed, "pack");
    const zone = timeZone(need(parsed, "time-zone"));
    const defaultLanguage = need(parsed, "language");
    if ([...name].length > 100) {
      throw new UsageError("--name is at most 100 characters");
    }
    if (UNPRINTABLE.test(name)) {
      throw new UsageError("--name has a character that cannot be printed");
    }
    if (!(PACKS as readonly string[]).includes(pack)) {
      throw new UsageError(`--pack is one of: ${PACKS.join(", ")}`);
    }
    if (zone === undefined) {
      throw new UsageError(
        "--time-zone is a named IANA time zone, such as Asia/Riyadh, without a plus sign",
      );
    }
    if (!LANGUAGE.test(defaultLanguage)) {
      throw new UsageError("--language is a language tag, such as ar or en-GB");
    }
    // The tenant's name is not recorded: it can be a person's. The row is, by its identifier.
    return ready(
      { pack, timeZone: zone, language: defaultLanguage },
      async (cross) => {
        const id = await createTenant(cross, { name, pack, timeZone: zone, defaultLanguage });
        return { value: id, subjectId: id };
      },
      (id, output) => output.out(`tenant created: ${id}`),
    );
  }

  if (command === "tenant list") {
    only(parsed, ["as"], 2);
    return ready(
      {},
      async (cross) => ({ value: await listTenants(cross) }),
      (tenants, output) => {
        output.out(`${tenants.length} tenant${tenants.length === 1 ? "" : "s"}`);
        for (const tenant of tenants) {
          output.out(
            [
              tenant.id,
              tenant.createdAt.toISOString(),
              tenant.pack,
              tenant.timeZone,
              tenant.defaultLanguage,
              shown(tenant.name),
            ].join("  "),
          );
        }
      },
    );
  }

  if (command === "channel connect") {
    only(parsed, ["as", "tenant", "channel", "number-id"], 2);
    const tenantId = need(parsed, "tenant");
    const channel = need(parsed, "channel");
    const receivingNumberId = need(parsed, "number-id");
    if (!UUID.test(tenantId)) {
      throw new UsageError("--tenant is a tenant's identifier, as tenant list shows it");
    }
    if (!(CHANNELS as readonly string[]).includes(channel)) {
      throw new UsageError(`--channel is one of: ${CHANNELS.join(", ")}`);
    }
    // The channel's own identifier of the number: digits, and never written with a plus sign.
    if (!/^[0-9]{5,20}$/.test(receivingNumberId)) {
      throw new UsageError("--number-id is the channel's identifier of the number: 5 to 20 digits");
    }
    return ready(
      { tenantId, channel, receivingNumberId },
      async (cross) => {
        const id = await connectChannel(cross, { tenantId, channel, receivingNumberId });
        return { value: id, subjectId: id };
      },
      (id, output) => output.out(`channel connected: ${id}`),
    );
  }

  if (command === "jobs list-dead") {
    only(parsed, ["as"], 2);
    return ready(
      {},
      async (cross) => ({ value: await listDeadJobs(cross) }),
      (jobs, output) => {
        output.out(
          `${jobs.length} dead job${jobs.length === 1 ? "" : "s"} (the oldest 100 at most)`,
        );
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
      },
    );
  }

  if (command === "jobs retry") {
    only(parsed, ["as"], 3);
    const jobId = parsed.words[2] as string;
    if (!UUID.test(jobId)) {
      throw new UsageError("the job's identifier is not one");
    }
    return ready(
      { jobId },
      async (cross) => {
        const type = await retryDeadJob(cross, jobId);
        if (type === undefined) {
          throw Object.assign(new Error("ops: there is no dead job with that identifier"), {
            code: "no-dead-job",
          });
        }
        return { value: type, subjectId: jobId };
      },
      (type, output) => output.out(`job queued again: ${jobId} (${type})`),
    );
  }

  if (command === "log show") {
    only(parsed, ["as", "limit"], 2);
    const limitText = parsed.options["limit"] ?? "50";
    const limit = /^[1-9][0-9]{0,3}$/.test(limitText) ? Number(limitText) : 0;
    if (limit < 1 || limit > LOG_LIMIT_MAX) {
      throw new UsageError(`--limit is a whole number from 1 to ${LOG_LIMIT_MAX}`);
    }
    return ready(
      { limit: String(limit) },
      async (cross) => ({ value: await readOperatorLog(cross, limit) }),
      (rows, output) => {
        output.out(`the newest ${rows.length} rows of the record`);
        for (const row of rows) {
          output.out(
            [
              row.at.toISOString(),
              row.invocationId,
              row.phase,
              shown(row.command),
              `as ${shown(row.operatorName)}`,
              JSON.stringify(row.arguments),
              row.outcome ?? "-",
              row.subjectId ?? "-",
            ].join("  "),
          );
        }
      },
    );
  }

  throw new UsageError("there is no such command");
}

/** Checks and runs one command. */
export async function run(cross: Database, argv: readonly string[], output: Output): Promise<void> {
  await prepare(argv)(cross, output);
}
