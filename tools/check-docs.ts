// Command-line entry for the document checks: `pnpm run check:docs`.
import { checkAll } from "./docs-checks.ts";
import { checkSharedNames } from "./names-check.ts";

const root = process.cwd();
const problems = [...checkAll(root), ...checkSharedNames(root)];
for (const problem of problems) {
  console.error(problem);
}
if (problems.length > 0) {
  console.error(`check:docs: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log("check:docs: ok");
