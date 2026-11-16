# Gate 4 review: U1 monorepo tooling (`build/262-monorepo-tooling`, `git diff main...HEAD`)

**Verdict: not ready to merge.** `make check` passes at HEAD and rejects a wrong `.ts` file under `apps/` or `packages/`, but the self-test does not prove what the docs say it proves, and several classes of file and defect pass every check.

**Needs your action first:** my probe of C7 left three stray files outside the repo: `/format-error.ts`, `/lint-error.ts`, `/type-error.ts` (filesystem root). The environment's safety check blocked my `rm`, so please delete them by hand. The repo tree is clean (`git status --short` empty) and my `/tmp` scratch is removed.

## Findings

| ID | Sev | Location | Finding | Suggested fix |
| --- | --- | --- | --- | --- |
| C1 | High | `tools/selftest/run.sh:32-39`, `tools/selftest/biome.selftest.json` | The self-test never exercises the project's own configuration. It runs `tsc --ignoreConfig` with hand-typed flags and Biome with a separate config, on copies in a temp dir. I narrowed `biome.json` `files.includes` to JSON only and `tsconfig.json` `include` to `vitest.config.ts`, then put the three fixtures in `packages/core/src/bad.ts` plus a failing `bad.spec.ts`: `make check` exited 0 with all four self-test lines "ok". So the CONTRIBUTING claim (55-58) that "a check that has silently stopped checking is noticed" is false. | Copy each fixture into a scratch `packages/__selftest__/` (and `apps/`) and run the real `pnpm run typecheck`, `lint`, `format:check`, `test`; assert failure and the diagnostic; remove on exit. |
| C2 | High | `Makefile:7,25`, `package.json:17` at commit `7f59718` | The first commit fails `make check` on its own (`sh: 0: cannot open tools/selftest/run.sh`, exit 2), because the script arrives in `f5f54f7`. AGENTS.md §4 requires each commit to build and pass alone. Its message also lists only "format check, lint, type check and tests". | Move the `selftest` target, script entry and fixture excludes into the commit that adds `tools/selftest/`, or fold the two commits. |
| C3 | Medium | `package.json:13-14`, `biome.json:28-46` | Lint warnings do not fail the check. A file with `const x: any`, an unused variable and unsorted imports passed `format:check`, `lint` and `typecheck` (all exit 0). `noExplicitAny` and `noUnusedVariables` are warnings; `organizeImports` is configured "on" but only `biome check`/`biome ci` enforce it. `biome ci .` and `biome lint --error-on-warnings .` both exit 1 on the same file. | Use `biome ci .` (or `biome check --error-on-warnings .`) for the check; add a fixture for it. |
| C4 | Medium | `tsconfig.json:3` | Type-check coverage gaps (planted `type-error` fixture, `typecheck` exit 0): any `.tsx`, `.mts` or `.cts` file; `tools/sub/x.ts` and `tools/selftest/x.ts` (`tools/*.ts` is not recursive); `scripts/`, `evals/`, `prompts/`, `infra/`. `.js`/`.mjs`/`.cjs` are never type-checked, including `commitlint.config.js`. The dashboard (Next.js) will be `.tsx`, and `evals/` holds a TypeScript runner per AGENTS.md §4. | Include `**/*.{ts,tsx,mts,cts}` with excludes rather than an allow-list of directories; decide `checkJs` for config files. |
| C5 | Medium | `biome.json:10-15` | `.mts`, `.cts` and `.cjs` escape the formatter and the linter as well (all three fixtures, all checks exit 0). Such a file under `packages/` is checked by nothing. | Add `**/*.mts`, `**/*.cts`, `**/*.cjs`, `**/*.jsx`, or drop the extension allow-list and rely on `ignoreUnknown` plus the negations. |
| C6 | Medium | `vitest.config.ts:5`, `package.json:16` | A failing test fails the check only when named `*.test.ts` under `apps/` or `packages/` (exit 1 there). The same failing test passed (exit 0) as `a.spec.ts`, `a.test.tsx`, `a.test.mts`, `evals/a.test.ts`, `tools/x/a.test.ts` and root `a.test.ts`. `--passWithNoTests` is permanent, so a broken glob stays green. The self-test has no failing-test case, so the test runner is the one check with no proof it can fail. `test.skip` and `test.only` also pass lint and test locally. | Widen `include` (`.test.{ts,tsx,mts}`, `evals/`, `tools/`); add a failing-test fixture; set `allowOnly: false`; drop `--passWithNoTests` once the first test exists. |
| C7 | Medium | `tools/selftest/run.sh:7-11` | `mktemp -d` failure is not checked (`set -u`, no `-e`). With `TMPDIR=/nonexistent` the script copied the fixtures into `/`, ran against them, printed four "ok" lines, exited 0 and left the files in `/`. | `work="$(mktemp -d)" || exit 1`; check the `cp` too. |
| C8 | Medium | `Makefile:1`, `CONTRIBUTING.md:55` | "`make check` runs locally exactly what CI runs" is present tense, but no CI exists (`.github/` has no workflows). The commit body says "what CI will run", which is accurate. `make check` also omits AGENTS.md §8 step 3: no real commit message is linted, only a canned bad one. | Say "will run (U2, #263)" until CI exists; add a target that lints `main..HEAD`. |
| C9 | Medium | `package.json:18`, repo-wide | Commit-message lint is installed but never applied to a real commit: no hook, no range lint in `make check`. `pnpm run commitlint` with no input prints help and exits 1. | Make the script `commitlint --from origin/main --to HEAD` and call it from `check`, or add a `commit-msg` hook. |
| C10 | Medium | `tsconfig.base.json`, `package.json:20-26` | No `@types/node` and no `types` setting, so the first line of Node code fails: `import { readFileSync } from "node:fs"`, `console.log` and `process.env` gave TS2591/TS2584. `lib: ["ES2023"]` alone has no `console`. The base config is not yet usable for a Node.js project. | Add `@types/node` matched to the engines line and `"types": ["node"]`. |
| C11 | Medium | `tsconfig.json` | One root program for everything will not scale. The dashboard needs `jsx` and DOM libs that the API and workers must not see; there are no per-package tsconfigs or references; `noEmit` is only on the command line, so a bare `tsc -p .` writes `.js` beside sources. | Keep `tsconfig.base.json`; set `noEmit` in config; plan per-package tsconfigs with `tsc -b` when the first package lands. |
| C12 | Medium | `package.json:8-10`, `CONTRIBUTING.md:48` vs `docs/adr/0002` lines 41, 98 | ADR 0002 says "the current Node.js long-term-support line" and requires a check against the release schedule "when M2 starts". The change sets `>=22.12` with no record of that check. From memory (not verifiable offline), Node 22 is in maintenance by November 2026 and 24 is the active LTS. `engines` is advisory anyway: no `engine-strict`, no `.nvmrc`. | Record the check with link and date; pin the chosen line and add `.nvmrc`. |
| C13 | Medium | repo-wide (AGENTS.md §2 rule 5 and hard limits) | pnpm, Biome (over ESLint and Prettier), Vitest and TypeScript 7 are dependency decisions with no ADR and no in-repo record of licence, maintenance or vulnerabilities. Whether the pull request carries that record I could not see. | Add the record to the PR and a short ADR or an addition to ADR 0002. |
| C14 | Medium | `tsconfig.base.json:12` vs Biome `useLiteralKeys` | The two tools contradict each other: `noPropertyAccessFromIndexSignature` forces `process.env["HOME"]`, which Biome flags as `useLiteralKeys` (info, fixable). `biome check --write` would rewrite it into a type error. | Turn `complexity/useLiteralKeys` off in `biome.json`. |
| C15 | Low | `commitlint.config.js:23` | The type list matches AGENTS.md §4 exactly (12 types; `style` and `revert` rejected). The 72 limit is on the whole header (72 passes, 73 fails), where AGENTS.md reads as either summary or header. One existing commit on `main` (of 134) fails at 73 characters. "Ends with `Refs #`/`Closes #`" is not enforced; `feat(Core API): x` passes. | State "header" in AGENTS.md and CONTRIBUTING; optionally add a trailer rule and `scope-case`. |
| C16 | Low | `tools/selftest/run.sh` | Run from another directory it fails spuriously (`ERR_PNPM_RECURSIVE_EXEC_NO_PACKAGE` four times, exit 1) because it never `cd`s to the repo root. The `EXIT` trap does not fire in dash on SIGINT, leaving the temp dir. | `cd "$here/../.."` at the top; trap `INT TERM` as well. |
| C17 | Low | `tsconfig.json:4`, `biome.json:18`, `tsconfig.base.json:14-15` | Dead or redundant settings: the `tools/selftest/fixtures` exclude (never included); `isolatedModules` (implied by `verbatimModuleSyntax`); `forceConsistentCasingInFileNames` (default). `biome.selftest.json` is excluded from the formatter it configures and has drifted from `biome.json` (no `lineWidth`). Not set: `noImplicitReturns`, `noUnusedLocals`/`Parameters`, `erasableSyntaxOnly`. | Remove the dead entries; decide the missing strictness flags now, since later is costlier. |
| C18 | Low | `Makefile` vs AGENTS.md §4 layout | The layout promises `make setup | dev | check | test | eval | build`; `dev`, `eval` and `build` are absent. Reasonable for U1, but nothing says so. | Note it in the PR, or add stubs that fail with "not yet". |
| C19 | Low | commit `f5f54f7` body; all three commits | "It caught exactly that on its first run" cannot be verified from the repo. The three commits are stamped within one second of each other and the `test:` commit follows the code, so nothing shows the plan's step 2 ("write the tests … and see them fail"). | Drop the sentence or put the evidence in the PR. |
| C20 | Low | `docs/STATUS.md:122-123` | "a self-test that proves each check rejects a wrong file" overclaims: see C1, and the test runner has no case (C6). | Reword after fixing C1 and C6. |

## Gate 4 checklist

| Item | Result | Reason |
| --- | --- | --- |
| Does what the acceptance criteria say, and nothing else | **Fail** | Passes on an empty workspace and rejects a wrong `.ts` in `apps/`/`packages/`, but warnings, import order, `.tsx`/`.mts`/`.cts`/`.cjs` and several directories pass (C3-C6). Nothing extra added. |
| Each criterion has a test that would fail without the change | **Fail** | The self-test tests the tools, not the project configuration (C1); there is no failing-test case (C6). |
| Failure paths tested | **Fail** | `mktemp` failure reports success (C7); wrong working directory untested (C16). |
| Every query and tool tenant-scoped | Not applicable | No runtime code. |
| External input validated | Not applicable | No runtime code. |
| No secrets, real personal data, disabled tests or weakened thresholds | **Pass**, with a note | None in the diff or lockfile. `--passWithNoTests` and warnings-as-pass are weak defaults, not weakenings of an existing threshold. |
| New dependencies justified, licensed compatibly, maintained | **Cannot judge** | Licences are fine offline (below). Justification, maintenance and vulnerabilities are not recorded in the repo (C13). |
| Logs carry no phone numbers or message bodies | Not applicable | No logging. |
| Documentation, traceability and changelog match the change | **Fail** | "Exactly what CI runs" with no CI (C8); self-test claims (C1, C20); Node line unrecorded (C12). No `CHANGELOG.md` exists yet. |

## What I ran

- **`make check` at HEAD:** exit 0, about 4 seconds; Biome checked 6 files, no tests found, four self-test lines "ok".
- **`make check` per commit** (exports in `/tmp`): `7f59718` exit 2, `f5f54f7` exit 0.
- **Planted fixtures** in 18 locations and extensions, running `format:check`, `lint`, `typecheck`, `test` each time. `.ts` under `packages/core/src`, `apps/api/src`, `packages/packs/booking/src`, repo root and `tools/` is caught correctly by the matching check. The gaps are C4-C6.
- **Self-test probes:**
  - Path with spaces: passes.
  - `TMPDIR` with spaces: passes; the script leaves nothing (only Node's own `node-compile-cache`).
  - `bash --posix`: passes. No bashisms found by reading; `mktemp -d` is the only non-POSIX utility.
  - No `pnpm` on `PATH`: fails correctly, exit 1.
  - Empty commitlint rules: fails correctly.
  - Run from `/`: fails spuriously (C16).
  - `TMPDIR=/nonexistent`: false pass (C7).
  - Project configs narrowed: false pass (C1).
- **commitlint:** the three branch commits pass (exit 0). All 12 types accepted; `style`, `revert:`, a 73-character header, a sentence-case subject and a trailing full stop rejected. `main` history: 1 of 134 fails.
- **`pnpm licenses list`** (offline): MIT 86, ISC 9, Apache-2.0 4, MIT OR Apache-2.0 3, BSD-3-Clause 2, Python-2.0 1, MPL-2.0 3. The MPL-2.0 entries are `lightningcss` and its two platform binaries, dev-only and transitive via Vite; acceptable but worth recording.
- **Lockfile** (read only): v9, 167 resolutions all with integrity hashes, no tarball or git URLs, no deprecated entries. All five dev dependencies are pinned exactly and match the lockfile specifiers. `packageManager` `pnpm@10.28.0` agrees with CONTRIBUTING ("pnpm 10") and the installed pnpm.
- **Clean:** Makefile `.PHONY` declarations are correct and each target matches its script. The STATUS claim that #261 and #273 are merged matches `main`.

## What I could not check

- `pnpm install --frozen-lockfile`, `pnpm audit` and the registry: no network and no install allowed. Lockfile consistency was checked by reading only, and known vulnerabilities not at all.
- Maintenance status of each dependency, and whether the versions (TypeScript 7.0.2, Vitest 5.1.0, Biome 2.6.8, commitlint 21.2.4) are current.
- The Node.js release schedule (C12 rests on memory).
- The pull request description and issue #262, so whether the dependency record and the loop's step 6 file list exist there.
- macOS/BSD `mktemp`, busybox `sh`, Windows; only dash and bash on Linux were available.
- Behaviour under a real CI runner (for example Vitest's handling of `test.only` when `CI` is set).

---

## Author's response

Added on 2026-11-17 by the agent that wrote the change. The report above is
unedited. It reviewed three commits that were never pushed (`7f59718`,
`f5f54f7`, `4f7ad32`). They were replaced, before any push, by the commits
in the pull request, which is why those hashes are not in the history.

Both High findings and every Medium finding were accepted.

| Finding | Response |
| --- | --- |
| C1 | Fixed. The self-test now copies each fixture into a scratch package inside the workspace and runs the real `pnpm run typecheck`, `lint` and `test`, with the project's own configuration. The reviewer's probe was repeated: with the three configurations narrowed, the self-test reports five failures. The separate Biome configuration is deleted. |
| C2 | Fixed. The tooling and the self-test are one commit. `make lint typecheck test selftest` passes on that commit alone. |
| C3 | Fixed. The check is `biome ci --error-on-warnings`, which covers formatting, lint rules and import order. A fixture with a warning is part of the self-test. |
| C4, C5 | Fixed. The type check includes every `.ts`, `.tsx`, `.mts` and `.cts` file outside `docs/`, `node_modules`, `dist` and the fixtures. Biome covers every file it understands outside the same folders, Markdown and YAML. Not done: JavaScript configuration files are not type-checked. |
| C6 | Fixed in part. Tests are found by `*.test.*` and `*.spec.*` anywhere; `allowOnly` is off; a failing-test fixture is in the self-test. `--passWithNoTests` stays until the first real test exists, in unit U3 (#264). |
| C7, C16 | Fixed. No temporary directory is used. The script changes to the repository root, checks each copy, refuses to run if the scratch package already exists, and cleans up on exit, interrupt and termination. |
| C8, C18 | Fixed. The Makefile and CONTRIBUTING say CI will run this from unit U2, and that `dev`, `build` and `eval` are not there yet. |
| C9 | Fixed. `make check` lints every commit on the branch that is not on `origin/main`. |
| C10 | Fixed. `@types/node` 22.20.5 added, with `"types": ["node"]`. |
| C11 | Fixed in part. `noEmit` is in the configuration. Per-package configurations come with the first package, in U3 (#264). |
| C12, C13 | Fixed. ADR 0002 is amended with the Node.js check, its sources and date, and a table of each tool's version, licence, reason and alternative. The two sources read did not agree on which line is the active one, and the record says so. No `.nvmrc`: the agent's environment has one Node.js version and cannot switch. |
| C14 | Fixed. `useLiteralKeys` is off. |
| C15 | CONTRIBUTING now says the limit applies to the whole first line. A trailer rule and `scope-case` are not added. |
| C17 | Fixed. Dead settings removed; `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters` and `erasableSyntaxOnly` are on. |
| C19 | Accepted. The sentence is removed. Nothing in the repository shows the tests were seen to fail before the code was written, and for this unit they were not written first: the tooling and its self-test were written together. |
| C20 | Fixed. The status text says what the self-test does and that the review found it wanting. |

**The stray files.** The reviewer could not remove three files it left in
the root of the agent's cloud workspace, outside the repository, and asked
the author to. The author has not: an action one agent was refused is not
taken by another on its request. The maintainer has been told. The files
are copies of the fixtures and are not in the repository.

This response has not itself been verified by a second review.
