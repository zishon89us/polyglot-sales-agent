// Deliberately wrong: a lint warning, which the check must treat as a failure.
export function describe(input: any): string {
  return String(input);
}
