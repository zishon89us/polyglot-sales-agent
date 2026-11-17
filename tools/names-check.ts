// Checks that every document which lists a shared name agrees with
// packages/core/src/names.ts (M2 unit U3; M1 retro, "one source for each
// shared fact"). Each source below is one place a list is written down.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import {
  HANDOVER_REASONS,
  HANDOVER_STATES,
  MESSAGE_CLASSES,
  MESSAGE_DIRECTIONS,
  MESSAGE_STATUSES,
} from "../packages/core/src/names.ts";

function read(root: string, path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function backticked(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1] as string);
}

/** The text between a heading line and the next heading of the same or a higher level. */
function section(text: string, heading: string): string | undefined {
  const start = text.indexOf(`\n${heading}\n`);
  if (start < 0) {
    return undefined;
  }
  const level = (heading.match(/^#+/) as RegExpMatchArray)[0].length;
  const rest = text.slice(start + heading.length + 2);
  const end = rest.search(new RegExp(`^#{1,${level}} `, "m"));
  return end < 0 ? rest : rest.slice(0, end);
}

/** The first cell of each body row of the first table whose header starts with the given cell. */
function firstColumn(text: string, headerCell: string): string[] | undefined {
  const lines = text.split("\n");
  const headers = lines.flatMap((line, index) =>
    line.startsWith(`| ${headerCell} |`) ? [index] : [],
  );
  // Exactly one such table, or the check cannot know which one it is reading.
  if (headers.length !== 1) {
    return undefined;
  }
  const header = headers[0] as number;
  const cells: string[] = [];
  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith("|")) {
      break;
    }
    cells.push((line.split("|")[1] as string).trim());
  }
  return cells;
}

function compare(where: string, found: readonly string[] | undefined, expected: readonly string[]) {
  if (found === undefined) {
    return [`${where}: the list was not found where the check expects it`];
  }
  const problems: string[] = [];
  for (const name of expected) {
    if (!found.includes(name)) {
      problems.push(`${where}: "${name}" is missing`);
    }
  }
  for (const name of found) {
    if (!expected.includes(name)) {
      problems.push(`${where}: "${name}" is not in packages/core/src/names.ts`);
    }
  }
  if (new Set(found).size !== found.length) {
    problems.push(`${where}: a name appears twice`);
  }
  return problems;
}

type Schema = {
  enum?: string[];
  items?: Schema;
  anyOf?: Schema[];
  properties?: Record<string, Schema>;
};

/** Every enum value a schema allows, across `items` and all `anyOf` branches. */
function enumOf(schema: Schema | undefined): string[] | undefined {
  if (schema === undefined) {
    return undefined;
  }
  const values = [
    ...(schema.enum ?? []),
    ...(enumOf(schema.items) ?? []),
    ...(schema.anyOf ?? []).flatMap((option) => enumOf(option) ?? []),
  ];
  return values.length > 0 ? values : undefined;
}

/** The one line that starts with the given text, or undefined if there is none or more than one. */
function onlyLine(text: string, start: string): string | undefined {
  const lines = text.split("\n").filter((line) => line.startsWith(start));
  return lines.length === 1 ? lines[0] : undefined;
}

/**
 * The names in the Python call or tuple at a marker. The brackets must hold
 * double-quoted strings and commas and nothing else: a variable, a `*`, a
 * comment, single quotes or a nested call is reported as not found rather
 * than read in part. This reads the script's text, not what it produces.
 */
function pythonStrings(text: string, marker: string): string[] | undefined {
  const at = text.indexOf(marker);
  if (at < 0 || text.indexOf(marker, at + 1) >= 0) {
    return undefined;
  }
  const inMarker = marker.lastIndexOf("(");
  const from = inMarker >= 0 ? at + inMarker : text.indexOf("(", at);
  const to = text.indexOf(")", from + 1);
  if (from < 0 || to < 0) {
    return undefined;
  }
  const inside = text.slice(from + 1, to);
  if (!/^\s*"[^"\n]+"(\s*,\s*"[^"\n]+")*\s*,?\s*$/.test(inside)) {
    return undefined;
  }
  return [...inside.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
}

export function checkSharedNames(root: string): string[] {
  const glossary = read(root, "docs/requirements/glossary.md");
  const dataModel = read(root, "docs/design/data-model.md");
  const machines = read(root, "docs/design/state-machines.md");
  const schemas = (
    parse(read(root, "docs/design/openapi.yaml")) as {
      components: { schemas: Record<string, Schema> };
    }
  ).components.schemas;
  const handover = schemas["Handover"]?.properties;
  const message = schemas["Message"]?.properties;

  const reasonRow = onlyLine(glossary, "| Handover reason |");
  const statusRow = onlyLine(
    section(dataModel, "### `messages` — tenant-owned") ?? "",
    "| `status` |",
  );
  const generator = read(root, "docs/design/tools/gen_openapi.py");
  const model = read(root, "docs/design/models/handover_machine.py");
  const policy = section(
    read(root, "docs/ai/guardrail-policy.md"),
    "## 6. When a conversation goes to a person",
  );
  const modelOpen = pythonStrings(model, "\nOPEN = ");
  const modelTerminal = pythonStrings(model, "\nTERMINAL = ");
  const policyReasons = firstColumn(policy ?? "", "Reason")?.flatMap(backticked);
  const machine2 = section(machines, "## 2. Handover") ?? "";
  const machine7 = section(machines, "## 7. Outbound message") ?? "";
  const classLabels = Object.values(MESSAGE_CLASSES);
  const classNames = Object.keys(MESSAGE_CLASSES);

  return [
    ...compare(
      "glossary, Handover reason",
      reasonRow === undefined ? undefined : backticked(reasonRow),
      HANDOVER_REASONS,
    ),
    ...compare(
      "glossary, Message classes table",
      firstColumn(section(glossary, "## Message classes") ?? "", "Class"),
      classLabels,
    ),
    ...compare(
      "data model, messages.status",
      statusRow === undefined ? undefined : backticked(statusRow.split("|")[2] as string),
      MESSAGE_STATUSES,
    ),
    ...compare(
      "state machines, section 2 states",
      firstColumn(machine2, "State")?.flatMap(backticked),
      HANDOVER_STATES,
    ),
    ...compare(
      "state machines, section 7 states",
      firstColumn(machine7, "State")?.flatMap(backticked),
      MESSAGE_STATUSES,
    ),
    ...compare("OpenAPI, Handover.state", enumOf(handover?.["state"]), HANDOVER_STATES),
    ...compare("OpenAPI, Handover.reasons", enumOf(handover?.["reasons"]), HANDOVER_REASONS),
    ...compare("OpenAPI, Message.status", enumOf(message?.["status"]), MESSAGE_STATUSES),
    ...compare("OpenAPI, Message.class", enumOf(message?.["class"]), classNames),
    ...compare("OpenAPI, Message.direction", enumOf(message?.["direction"]), MESSAGE_DIRECTIONS),
    // The script that produces the OpenAPI file restates the lists; without
    // these, regenerating the file would silently bring old names back.
    ...compare(
      "OpenAPI generator, Handover state",
      pythonStrings(generator, '"state": enum("waiting"'),
      HANDOVER_STATES,
    ),
    ...compare(
      "OpenAPI generator, Handover reasons",
      pythonStrings(generator, '"reasons": arr(enum('),
      HANDOVER_REASONS,
    ),
    ...compare(
      "OpenAPI generator, Message status",
      pythonStrings(generator, '"status": nullable(enum("pending"'),
      MESSAGE_STATUSES,
    ),
    ...compare(
      "OpenAPI generator, Message class",
      pythonStrings(generator, '"class": nullable(enum('),
      classNames,
    ),
    ...compare(
      "OpenAPI generator, Message direction",
      pythonStrings(generator, '"direction": enum('),
      MESSAGE_DIRECTIONS,
    ),
    ...compare(
      "handover model, OPEN and TERMINAL",
      modelOpen === undefined || modelTerminal === undefined
        ? undefined
        : [...modelOpen, ...modelTerminal],
      HANDOVER_STATES,
    ),
    // The policy's table names a reason once per trigger, so repeats are expected there.
    ...compare(
      "guardrail policy, section 6 reasons",
      policyReasons === undefined ? undefined : [...new Set(policyReasons)],
      HANDOVER_REASONS,
    ),
  ];
}
