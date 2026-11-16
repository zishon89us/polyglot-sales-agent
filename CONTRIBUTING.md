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
