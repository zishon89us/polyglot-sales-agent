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
  # expect_rejection <name> <diagnostic> <text that must also appear> <command...>
  # The third argument ties the diagnostic to the planted file: without it, the
  # same diagnostic from some unrelated file would hide a check that no longer
  # covers the scratch package.
  name="$1"
  pattern="$2"
  about="$3"
  shift 3
  output="$("$@" 2>&1)"
  status=$?
  if [ "$status" -eq 0 ]; then
    echo "selftest: FAIL - $name passed on a file that is wrong"
    failed=1
  elif ! printf '%s' "$output" | grep -q "$about"; then
    echo "selftest: FAIL - $name failed, but did not mention '$about':"
    printf '%s\n' "$output" | head -5
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
expect_rejection "type check" "TS2322" "__selftest__/src/bad.ts" pnpm run typecheck

plant type-error.ts bad.tsx
expect_rejection "type check of a .tsx file" "TS2322" "__selftest__/src/bad.tsx" pnpm run typecheck

plant lint-error.ts bad.ts
expect_rejection "lint" "noDebugger" "__selftest__/src/bad.ts" pnpm run lint

plant warning.ts bad.ts
expect_rejection "lint warning" "noExplicitAny" "__selftest__/src/bad.ts" pnpm run lint

plant format-error.ts bad.ts
expect_rejection "format check" "File content differs from formatting output" "__selftest__/src/bad.ts" pnpm run lint

plant failing.test.ts bad.test.ts
expect_rejection "test run" "selftest fixture fails on purpose" "__selftest__/src/bad.test.ts" pnpm run test

cleanup
expect_rejection "commit message lint" "type-empty" "Updated some stuff" \
  sh -c 'echo "Updated some stuff." | pnpm exec commitlint'

exit "$failed"
