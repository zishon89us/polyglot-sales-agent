# `make check` is the one local check, and the `check` job of
# .github/workflows/ci.yml runs exactly this. CI adds three things that need the
# network or GitHub: the dependency audit (`make audit`), the secret scan and a
# lint of the pull-request title.
#
# Not here yet: `build` and `eval`, which AGENTS.md section 4 lists. There is
# nothing to build (Node runs the sources, ADR 0002); `eval` arrives with the
# eval harness (M3).
# The self-test plants wrong files in the workspace while it runs, so targets
# must not run in parallel with it.
.NOTPARALLEL:
.PHONY: setup identity check format lint typecheck test selftest commitlint docs audit \
	db-up db-setup db-down dev dev-down e2e

setup:
	pnpm install --frozen-lockfile

# For the maintainer and the AI agent only: author commits in this clone under
# the maintainer's identity (AGENTS.md section 2).
identity:
	sh tools/git-identity.sh set

# The tests need a PostgreSQL 16 server. `db-up` starts one in Docker;
# any server works if PSA_TEST_ADMIN_URL in `.env` points at it. `db-setup`
# prepares the development database: the three roles, the migrations, then
# the isolation check. It reads `.env` (copy `.env.example`). The database
# itself must exist and be UTF-8: the migrations refuse another encoding.
# On a server whose default is another, make it with
#   CREATE DATABASE psa ENCODING 'UTF8' TEMPLATE template0;
# and remake a database that was made otherwise.
db-up:
	docker compose up --detach --wait db

db-setup:
	pnpm run db bootstrap
	pnpm run db up
	pnpm run db check

db-down:
	docker compose down

# The whole product on this machine, in Docker: the database, a demo tenant,
# the API, the worker, and the stand-in for WhatsApp with its page at
# http://127.0.0.1:4010. `e2e` sends a message through it and waits for the
# echo. Development only: see `docker-compose.yml`.
dev:
	docker compose up --build

dev-down:
	docker compose down --volumes

e2e:
	node tools/e2e.ts

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
