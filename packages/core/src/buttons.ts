// What a button's payload is (ADR 0014, "Buttons of a pack"; design note
// docs/design/notes/m3-u5-buttons-captions.md, section 2). Every payload
// begins with its owner: `core` for the core's own buttons, a pack's name
// for a pack's. A channel carries a payload as text and does not read it.

import { CORE_BUTTONS, type CoreButton } from "./names.ts";

/** The owner of the core's own buttons. Not a pack's name: no pack may be called this. */
export const CORE_BUTTON_OWNER = "core";

/** The longest payload, in characters. */
export const BUTTON_PAYLOAD_MAX = 256;

export interface ButtonPayload {
  /** `core`, or a pack's name. */
  readonly owner: string;
  readonly action: string;
  /** What follows the action: the owner's own, or null. */
  readonly rest: string | null;
}

const WORD = "[a-z][a-z0-9-]{0,39}";
const PAYLOAD = new RegExp(`^(${WORD})\\.(${WORD})(?:\\.([\\x21-\\x7e]+))?$`);

/** The payload of one of the core's own buttons. */
export function coreButton(action: CoreButton): string {
  if (!(CORE_BUTTONS as readonly string[]).includes(action)) {
    throw new RangeError("not one of the core's buttons");
  }
  return `${CORE_BUTTON_OWNER}.${action}`;
}

/**
 * Reads a payload: `<owner>.<action>` or `<owner>.<action>.<rest>`, split
 * at its first two full stops. Undefined for anything else. The text comes
 * from a customer's app, so it is untrusted: what is read here is who the
 * payload claims to be for, not that the customer was ever shown it.
 */
export function readButtonPayload(payload: unknown): ButtonPayload | undefined {
  if (typeof payload !== "string" || payload.length > BUTTON_PAYLOAD_MAX) {
    return undefined;
  }
  const match = PAYLOAD.exec(payload);
  if (match === null) {
    return undefined;
  }
  return { owner: match[1] as string, action: match[2] as string, rest: match[3] ?? null };
}

/** The core's own button a payload is, or undefined: another owner's, or an action the core does not have. */
export function coreButtonOf(payload: unknown): CoreButton | undefined {
  const read = readButtonPayload(payload);
  if (read === undefined || read.owner !== CORE_BUTTON_OWNER || read.rest !== null) {
    return undefined;
  }
  return CORE_BUTTONS.find((action) => action === read.action);
}
