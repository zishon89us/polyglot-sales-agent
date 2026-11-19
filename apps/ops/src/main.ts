// The operator's command-line program:
//   node --env-file-if-exists=.env apps/ops/src/main.ts tenant list --as <name>
// It connects as the cross-tenant role, whose address is given only to the
// processes that need it.

import { CROSS_ROLE, closeDatabase, databaseReady, openDatabase } from "@polyglot-sales-agent/db";
import { run, USAGE, UsageError } from "./commands.ts";

const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes("--help")) {
  console.log(USAGE);
  process.exit(argv.length === 0 ? 2 : 0);
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
  await run(cross, argv, { out: (line) => console.log(line) });
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`ops: ${error.message}\n\n${USAGE}`);
    status = 2;
  } else {
    // The message only when it is this program's own: a database error can carry a value.
    const message =
      error instanceof Error && error.message.startsWith("ops: ") ? error.message : undefined;
    const code = (error as { code?: unknown } | null)?.code;
    console.error(
      message ?? `ops: the command failed (${typeof code === "string" ? code : "error"})`,
    );
    status = 1;
  }
} finally {
  await closeDatabase(cross);
}
process.exit(status);
