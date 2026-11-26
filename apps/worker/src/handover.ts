// What a customer is told when their session is handed over (M3 unit
// U11; design note docs/design/notes/m3-u11-handover.md, section 4): the
// emergency text, or that a person will reply, with the next opening and
// the support contact when the business is closed and both can be given.

import {
  composeMessage,
  type FixedTextSet,
  fillFixedText,
  nextOpening,
  openAt,
} from "@polyglot-sales-agent/core";
import type { HandoverTell } from "@polyglot-sales-agent/db";

export function handoverTeller(texts: FixedTextSet): HandoverTell {
  return (given) => {
    const picked = texts.pick(given.preferred, given.tenantDefault).texts;
    let text: string;
    if (given.emergency) {
      text = picked.emergency;
    } else {
      let closed: string | undefined;
      try {
        if (!openAt(given.businessHours, given.timeZone, given.at)) {
          const opening = nextOpening(given.businessHours, given.timeZone, given.at);
          if (opening !== undefined && given.supportContact !== null) {
            closed = fillFixedText(picked["handover-out-of-hours"], {
              opening,
              contact: given.supportContact,
            });
          }
        }
      } catch {
        // A time zone that cannot be read: no opening can be given.
        closed = undefined;
      }
      // With no opening to give, the text that says only that a person will reply.
      text = closed ?? picked["handover-in-hours"];
    }
    return composeMessage([given.answerIsAutomated ? picked["automated-assistant"] : null, text]);
  };
}
