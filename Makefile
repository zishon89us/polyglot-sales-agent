# `make check` is the one local check, and the `check` job of
# .github/workflows/ci.yml runs exactly this. CI adds three things that need the
# network or GitHub: the dependency audit (`make audit`), the secret scan and a
# lint of the pull-request title.
#
# Not here yet: `dev`, `build` and `eval`, which AGENTS.md section 4 lists.
# They arrive with the first app (M2) and the eval harness (M3).
# The self-test plants wrong files in the workspace while it runs, so targets
# must not run in parallel with it.
.NOTPARALLEL:
.PHONY: setup identity check format lint typecheck test selftest commitlint docs audit \
	db-up db-setup db-down

setup:
	pnpm install --frozen-lockfile

# For the maintainer and the AI agent only: author commits in this clone under
# the maintainer's identity (AGENTS.md section 2).
identity:
	sh tools/git-identity.sh set

# The tests need a PostgreSQL 16 server. `db-up` starts one in Docker;
# any server works if PSA_TEST_ADMIN_URL in `.env` points at it. `db-setup`
# prepares the development database: the three roles, the migrations, then
# the isolation check. It reads `.env` (copy `.env.example`).
db-up:
	docker compose up --detach --wait db

db-setup:
	pnpm run db bootstrap
	pnpm run db up
	pnpm run db check

db-down:
	docker compose down

# lint covers formatting, lint rules (warnings fail) and import order.
# test needs the database server (see db-up).
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
