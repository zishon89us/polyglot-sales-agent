// Where the model client's traces go: the database, one row for a call, in
// a transaction of its own (M3 unit U6).

import type { TraceRecorder } from "@polyglot-sales-agent/ai";
import { type Database, storeTrace } from "@polyglot-sales-agent/db";

/** The recorder a client is built with. `app` is the application role's. */
export function traceRecorder(app: Database): TraceRecorder {
  return async (trace) => {
    await storeTrace(app, trace);
  };
}
