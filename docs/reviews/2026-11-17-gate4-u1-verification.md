# Gate 4 narrow verification: U1 monorepo tooling

The reviewer's report follows, as received.

## Step 1 — C1: self-test against narrowed project config

| Config narrowed | Exit | FAIL lines |
| --- | --- | --- |
| none (baseline, from repo root) | 0 | none (7 ok) |
| none, run from `/tmp` | 0 | none (7 ok) |
| `tsconfig.json` `include` → `["vitest.config.ts"]` | 1 | type check; type check of a .tsx file |
| `biome.json` `files.includes` → `["**/*.json"]` | 1 | lint; lint warning; format check |
| `vitest.config.ts` `include` → `["nowhere/*.test.ts"]` | 1 | test run |
| `package.json` lint without `--error-on-warnings` (extra probe) | 1 | lint warning |

- No `packages/__selftest__` was left after any run, including `timeout -s INT 2` (exit 124, after 4 cases).
- An empty `packages/` directory exists, but it was already there before I started.
- All four files were restored byte-identical; `git status --short` is empty; no worktrees or scratch files remain.

## Step 2 — C2: `make lint typecheck test selftest` per commit (fresh worktree, `node_modules` copied)

| Commit | Exit |
| --- | --- |
| 6796830 (first) | 0 |
| 8409abc | 0 |
| 699f2d4 | 0 |
| 3b317ba (HEAD) | 0 |

`make commitlint` at HEAD in the main checkout: exit 0 (0 problems, 0 warnings; `git identity: ok`).

**C1: RESOLVED.** **C2: RESOLVED** for the four targets run; `commitlint` was only run at HEAD.

## New findings

| ID | Sev | File | Finding | Fix |
| --- | --- | --- | --- | --- |
| N1 | High | `tools/git-identity.sh:24` | `check` fails open. With `origin/main` missing (ref deleted in a scratch clone, a wrong-author commit present) `git log` prints `fatal: ambiguous argument` and the script prints `git identity: ok`, exit 0. Same outside a repository. A single-branch or shallow CI clone would always pass. | Run `git rev-parse --verify origin/main` first and exit 1 on failure; capture `git log` separately and check its status. |
| N2 | Medium | `tools/git-identity.sh:24` | The match is an unanchored regex. Author `Mallory Zeeshan Hassan Memon <right email>` passes (exit 0). Email `…@usersXnoreply.github.com` also passes, because `.` is a wildcard. A plainly wrong author (`Mallory <m@x.io>`) is rejected (exit 1), and the right author passes. | Compare exactly: `git log --format='%an <%ae>'` with `grep -Fxv "$NAME <$EMAIL>"`, printing the hash separately. |
| N3 | Medium | `Makefile:11`, `tools/selftest/run.sh:15` | `make -j4 lint typecheck test selftest` exits 2. The self-test plants its fixture in the live workspace, so the parallel `typecheck` reports `packages/__selftest__/src/bad.ts(2,14): error TS2322`. `make -j check`, or any editor or watcher running during the self-test, fails spuriously. | Add `.NOTPARALLEL:` to the Makefile, or make `selftest` depend on the other three targets. |
| N4 | Medium | `tools/selftest/run.sh:43` | The expected diagnostic is not tied to the fixture's path. On my first biome attempt I narrowed `files.includes` in a way that also left `biome.json` itself mis-formatted. The "format check" case then reported `ok` although the fixture was not covered; the diagnostic came from `biome.json`. Any unrelated file with the same diagnostic masks a lost-coverage case. | Require the pattern and `packages/__selftest__` in the same diagnostic, for example by grepping for the scratch path as well. |
| N5 | Medium | `tools/git-identity.sh:18-20`, `Makefile:9` | `make setup` writes the maintainer's `user.name` and `user.email` into the clone's git config before installing. This is by design per the script header, but any other contributor who runs `make setup` then authors commits as the maintainer with no prompt. The committer field is not checked (committer `Mallory`, right author: exit 0). I did not run `make setup` (it installs); this is from reading the script plus the committer probe. | Make it a separate, opt-in target (`make identity`), or refuse when a different identity is already configured. |

Could not check: `make setup` and `pnpm install --frozen-lockfile` (no installs or network), `make commitlint` on the three earlier commits, behaviour under a real CI clone, and SIGTERM or an interrupt landing mid-`cp` (only SIGINT at 2 s was tried).

---

## Author's response

Added on 2026-11-17 by the agent that wrote the change. The report above is
unedited; it has no title because the reviewer was asked for no preamble.
It is the narrow verification of the two High findings of
`2026-11-17-gate4-u1-tooling.md`, and it reviewed the branch at `3b317ba`.

Both earlier High findings are confirmed resolved. The new High finding was
in the commit-identity check, which was added after the first review and so
had never been reviewed.

| Finding | Response |
| --- | --- |
| N1 | Fixed. The check verifies that `origin/main` exists and stops with an error if it does not, and checks the status of each git command. Probed: in a repository with no `origin/main` it exits 1. |
| N2 | Fixed. The author is compared as an exact string. Probed: an author whose name has a prefix before the maintainer's, with the right address, exits 1. |
| N3 | Fixed. The Makefile declares `.NOTPARALLEL`. `make -j4 lint typecheck test selftest` exits 0. An editor or watcher running during the self-test can still see the planted file for a moment; that is not addressed. |
| N4 | Fixed. Each case must print its diagnostic and also the path of the planted file. |
| N5 | Fixed. Setting the identity is its own target, `make identity`, for the maintainer and the agent; `make setup` no longer touches git configuration. It refuses to replace a different identity already set in the clone. The check now applies only to commits that name the agent as co-author, so another contributor's commits keep their own author. Probed: such a commit passes. The committer field is still not checked. |

These fixes are in the commit after `3b317ba` and have not been reviewed
by a third pass. The probes named above were run by the author.
