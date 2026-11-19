// The operator's command-line program:
//   node --env-file-if-exists=.env apps/ops/src/main.ts tenant list --as <name>
// It connects as the cross-tenant role, whose address is given only to the
// processes that need it.
//
// Exit status: 0 done; 1 failed; 2 written wrongly; 3 done, but the second
// row of the record could not be written.

import { CROSS_ROLE, closeDatabase, databaseReady, openDatabase } from "@polyglot-sales-agent/db";
import { type Prepared, prepare, RecordIncomplete, USAGE, UsageError } from "./commands.ts";

const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes("--help")) {
  console.log(USAGE);
  process.exit(argv.length === 0 ? 2 : 0);
}
// Checked in full before any connection is made.
let command: Prepared;
try {
  command = prepare(argv);
} catch (error) {
  console.error(
    error instanceof UsageError
      ? `ops: ${error.message}\n\n${USAGE}`
      : "ops: could not read the command",
  );
  process.exit(2);
}
const url = process.env["PSA_DB_CROSS_URL"];
if (url === undefined || url.trim() === "") {
  console.error("ops: PSA_DB_CROSS_URL is not set");
  process.exit(1);
}
const cross = openDatabase(CROSS_ROLE, url.trim(), { max: 2 });
let status = 0;
try {
  if (!(await databaseReady(cross))) {
    throw new Error(`ops: PSA_DB_CROSS_URL does not reach the database as ${CROSS_ROLE}`);
  }
  await command(cross, { out: (line) => console.log(line) });
} catch (error) {
  // The message only when it is this program's own: a database error can carry a value.
  const message =
    error instanceof Error && error.message.startsWith("ops: ") ? error.message : undefined;
  const code = (error as { code?: unknown } | null)?.code;
  console.error(
    message ?? `ops: the command failed (${typeof code === "string" ? code : "error"})`,
  );
  status = error instanceof RecordIncomplete ? 3 : 1;
} finally {
  await closeDatabase(cross);
}
process.exit(status);
