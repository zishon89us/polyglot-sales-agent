// Limits how much work one source can cause with requests that fail the
// signature check (issue #154, threat T4). Only failures count, so the
// channel's own traffic, which is validly signed, never trips it.
//
// It lives in the memory of one process: with several API processes each
// counts on its own, and a restart forgets. The numbers are the agent's
// proposals (`docs/design/api.md`, section 8).

export interface LimiterOptions {
  /** This many bad signatures from one source within the window block it. */
  readonly limit: number;
  readonly windowMs: number;
  /** How long a blocked source is refused. */
  readonly blockMs: number;
  /** The most sources remembered; beyond it the one seen longest ago is forgotten. */
  readonly maxSources: number;
}

export const WEBHOOK_LIMITS: LimiterOptions = {
  limit: 10,
  windowMs: 60_000,
  blockMs: 60_000,
  maxSources: 10_000,
};

interface Entry {
  windowStart: number;
  count: number;
  blockedUntil: number;
}

export class BadSignatureLimiter {
  readonly #options: LimiterOptions;
  readonly #sources = new Map<string, Entry>();

  constructor(options: LimiterOptions = WEBHOOK_LIMITS) {
    this.#options = options;
  }

  /** True while the source is refused. Checked before a request's body is read. */
  isBlocked(source: string, now: number): boolean {
    const entry = this.#sources.get(source);
    return entry !== undefined && now < entry.blockedUntil;
  }

  /** Counts one request that failed the signature check. */
  recordBad(source: string, now: number): void {
    let entry = this.#sources.get(source);
    if (entry === undefined || now - entry.windowStart >= this.#options.windowMs) {
      entry = { windowStart: now, count: 0, blockedUntil: entry?.blockedUntil ?? 0 };
    }
    entry.count += 1;
    if (entry.count >= this.#options.limit) {
      entry.blockedUntil = now + this.#options.blockMs;
      entry.windowStart = now;
      entry.count = 0;
    }
    // Set again so that the map's order is the order of last use.
    this.#sources.delete(source);
    this.#sources.set(source, entry);
    while (this.#sources.size > this.#options.maxSources) {
      this.#sources.delete(this.#sources.keys().next().value as string);
    }
  }

  /** How many sources are remembered. For tests. */
  get size(): number {
    return this.#sources.size;
  }
}
