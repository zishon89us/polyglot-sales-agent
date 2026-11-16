# `make check` is the one local check. CI will run exactly this from M2 unit
# U2 (#263); until then nothing runs it automatically.
#
# Not here yet: `dev`, `build` and `eval`, which AGENTS.md section 4 lists.
# They arrive with the first app (M2) and the eval harness (M3).
.PHONY: setup check format lint typecheck test selftest commitlint

setup:
	sh tools/git-identity.sh set
	pnpm install --frozen-lockfile

# lint covers formatting, lint rules (warnings fail) and import order.
check: lint typecheck test selftest commitlint

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

# Lints every commit on this branch that is not on origin/main, and checks
# that each is authored under the maintainer's identity.
commitlint:
	pnpm run commitlint
	sh tools/git-identity.sh check
