# `make check` is the one local check, and the `check` job of
# .github/workflows/ci.yml runs exactly this. CI adds two things that need the
# network or GitHub: the dependency audit (`make audit`) and the secret scan.
#
# Not here yet: `dev`, `build` and `eval`, which AGENTS.md section 4 lists.
# They arrive with the first app (M2) and the eval harness (M3).
# The self-test plants wrong files in the workspace while it runs, so targets
# must not run in parallel with it.
.NOTPARALLEL:
.PHONY: setup identity check format lint typecheck test selftest commitlint docs audit

setup:
	pnpm install --frozen-lockfile

# For the maintainer and the AI agent only: author commits in this clone under
# the maintainer's identity (AGENTS.md section 2).
identity:
	sh tools/git-identity.sh set

# lint covers formatting, lint rules (warnings fail) and import order.
check: lint typecheck test docs selftest commitlint

format:
	pnpm run format

lint:
	pnpm run lint

typecheck:
	pnpm run typecheck

test:
	pnpm run test

selftest:
	pnpm run selftest

# Document checks: stories against the traceability table, the sections of
# each decision record, relative links, and a lint of the OpenAPI file.
docs:
	pnpm run check:docs
	pnpm run lint:openapi

# Needs the network. Fails on a known vulnerability rated high or critical.
audit:
	pnpm run audit

# Lints every commit on this branch that is not on origin/main, and checks
# that each commit the agent co-authored is authored under the maintainer's
# identity.
commitlint:
	pnpm run commitlint
	sh tools/git-identity.sh check
