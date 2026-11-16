#!/bin/sh
# Proves that the project's own checks fail on deliberately wrong files
# (M2 unit U1). A check that cannot fail is not a check.
#
# Each fixture is copied into a scratch package inside the workspace and the
# real script is run (`pnpm run typecheck`, `lint`, `test`), so the project's
# own tsconfig.json, biome.json and vitest.config.ts are what is exercised.
# A case passes only if the script fails AND prints the diagnostic named
# beside it, so a tool that crashes, or fails for another reason, does not
# count. The scratch package is removed on exit.
set -u
here="$(cd "$(dirname "$0")" && pwd)" || exit 1
root="$(cd "$here/../.." && pwd)" || exit 1
cd "$root" || exit 1
scratch="$root/packages/__selftest__"
failed=0

cleanup() { rm -rf "$scratch"; }
trap cleanup EXIT
trap 'cleanup; exit 130' INT TERM

if [ -e "$scratch" ]; then
  echo "selftest: $scratch already exists; remove it and run again"
  trap - EXIT
  exit 1
fi

plant() {
  # plant <fixture> <name in the scratch package>
  cleanup
  mkdir -p "$scratch/src" || exit 1
  cp "$here/fixtures/$1" "$scratch/src/$2" || exit 1
}

expect_rejection() {
  name="$1"
  pattern="$2"
  shift 2
  output="$("$@" 2>&1)"
  status=$?
  if [ "$status" -eq 0 ]; then
    echo "selftest: FAIL - $name passed on a file that is wrong"
    failed=1
  elif ! printf '%s' "$output" | grep -q "$pattern"; then
    echo "selftest: FAIL - $name failed, but not with '$pattern':"
    printf '%s\n' "$output" | head -5
    failed=1
  else
    echo "selftest: ok - $name rejects its fixture ($pattern)"
  fi
}

plant type-error.ts bad.ts
expect_rejection "type check" "TS2322" pnpm run typecheck

plant type-error.ts bad.tsx
expect_rejection "type check of a .tsx file" "TS2322" pnpm run typecheck

plant lint-error.ts bad.ts
expect_rejection "lint" "noDebugger" pnpm run lint

plant warning.ts bad.ts
expect_rejection "lint warning" "noExplicitAny" pnpm run lint

plant format-error.ts bad.ts
expect_rejection "format check" "File content differs from formatting output" pnpm run lint

plant failing.test.ts bad.test.ts
expect_rejection "test run" "selftest fixture fails on purpose" pnpm run test

cleanup
expect_rejection "commit message lint" "type-empty" \
  sh -c 'echo "Updated some stuff." | pnpm exec commitlint'

exit "$failed"
