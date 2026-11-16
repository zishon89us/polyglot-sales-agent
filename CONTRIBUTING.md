# Contributing

The full conventions are in [`AGENTS.md`](AGENTS.md), section 4. This page is
the short version for anyone opening an issue or a pull request.

## Workflow

1. Every change starts as an issue. Use a template and give acceptance
   criteria.
2. Branch from `main` as `<type>/<issue-number>-<slug>`, for example
   `feat/42-booking-tool`.
3. Keep the pull request to one issue and small enough to review in one
   sitting.
4. Fill in the pull request template, including how the change was tested and
   its security and privacy impact.
5. Pull requests are squash-merged, so the pull request title must be a valid
   conventional commit.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/):
`type(scope): summary`, imperative, 72 characters or fewer.

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`,
`chore`, `security`, and two for AI behaviour changes:

- `prompt` — a change to a versioned prompt.
- `eval` — a change to eval datasets, graders or thresholds.

The body says why the change was made and ends with `Refs #<issue>` or
`Closes #<issue>`.

## Rules that are never waived

- No secrets, real phone numbers or real customer conversations in the
  repository, including tests, fixtures and screenshots.
- No test or eval threshold is skipped or weakened to get a green build.
- No change to AI behaviour merges without eval results in the pull request.

## AI-assisted contributions

Most of this repository is written by an AI agent directed by the maintainer.
Commits made by the agent carry a `Co-Authored-By` trailer. If you use an AI
tool for a contribution, say so in the pull request.

## Working on the code

You need Node.js 22.12 or later and pnpm 10 (`corepack enable` provides it).

```sh
make setup   # install the locked dependencies
make check   # lint and format, type check, tests, document checks, self-test, commit messages
```

`make check` is the one local check, and CI runs exactly this on every pull
request, on Node.js 22 and 26. CI also runs a dependency audit
(`make audit`, which needs the network) and a secret scan.

- **Lint** covers formatting, lint rules and import order. Warnings fail.
- **Self-test.** It copies deliberately wrong files from
  `tools/selftest/fixtures/` into a scratch package and runs the real
  checks on them with the project's own configuration. If a check accepts
  its wrong file, the self-test fails. It covers the type check, lint,
  formatting, the test run and the commit-message lint. It does not cover
  every file type or folder; it shows each check can fail, not that
  nothing escapes it.
- **Document checks.** Every story has a row in the traceability table;
  every decision record has its sections and is in the index; relative
  links resolve; the OpenAPI file lints.
- **Commit messages** on your branch are linted against `AGENTS.md` section
  4. The 72-character limit applies to the whole first line.
