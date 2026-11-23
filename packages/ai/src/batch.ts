// What of a batch one call is given (design note, section 4, T1 to T6;
// guardrail policy, I3). Pure: the messages themselves stay stored whole.

import { BATCH_TEXT_MAX } from "@polyglot-sales-agent/core";

export interface BoundedBatch {
  /** What the model is given, oldest first: the end of the batch, with no gap in it. */
  readonly texts: readonly string[];
  /** How many older messages were left out whole. */
  readonly leftOut: number;
  /** The newest message alone was over the limit, and only its beginning is kept. */
  readonly cut: boolean;
}

/**
 * Keeps the newest texts that fit within `max` code points together. It
 * takes texts only: a message with no text is not given to it. A cut
 * falls between code points; it can fall inside a letter with its marks.
 */
export function boundBatch(texts: readonly string[], max: number = BATCH_TEXT_MAX): BoundedBatch {
  if (!Number.isInteger(max) || max < 1) {
    throw new RangeError("the limit is a whole number above 0");
  }
  const newest = texts.at(-1);
  if (newest === undefined) {
    return { texts: [], leftOut: 0, cut: false };
  }
  const points = [...newest];
  if (points.length > max) {
    return { texts: [points.slice(0, max).join("")], leftOut: texts.length - 1, cut: true };
  }
  const kept: string[] = [];
  let used = 0;
  for (let index = texts.length - 1; index >= 0; index -= 1) {
    const text = texts[index] as string;
    const size = [...text].length;
    // The first that does not fit ends it: nothing older is kept past a gap.
    if (used + size > max) {
      break;
    }
    kept.unshift(text);
    used += size;
  }
  return { texts: kept, leftOut: texts.length - kept.length, cut: false };
}
