// The packs a deployment runs (ADR 0014). This file holds the map and
// nothing else. To add a pack, add its line here.

import booking from "@polyglot-sales-agent/pack-booking";
import faqOnly from "@polyglot-sales-agent/pack-faq-only";
import type { PackRegistry } from "@polyglot-sales-agent/pack-interface";

export const PACKS: PackRegistry = {
  booking,
  "faq-only": faqOnly,
};
