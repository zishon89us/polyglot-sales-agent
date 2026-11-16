// Deliberately wrong: the linter must fail on this file.
export function isMissing(value: number): boolean {
  debugger;
  return value == null || value == undefined;
}
