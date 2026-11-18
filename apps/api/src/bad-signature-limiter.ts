// Limits how much work one source can cause with requests that are refused
// (issue #154, threat T4): a failed signature check, a body over the size
// limit, a wrong registration token. Only refusals count, so the channel's
// own traffic, which is validly signed, never trips it.
//
// What it does not do: bound the work of requests that arrive together.
// The check runs before a body is read and the count rises after, so a
// source can have any number of bodies on their way in at once. Bounding
// that needs a limit on connections, which is the platform's
// (`docs/design/api.md`, section 8).
//
// It lives in the memory of one process: with several API processes each
// counts on its own, and a restart forgets. The numbers are the agent's
// proposals.

export interface LimiterOptions {
  /** This many refusals from one source within any stretch of `windowMs` block it. */
  readonly limit: number;
  readonly windowMs: number;
  /** How long a blocked source is refused. */
  readonly blockMs: number;
  /** The most sources remembered. Beyond it one is forgotten: the unblocked one used longest ago. */
  readonly maxSources: number;
}

export const WEBHOOK_LIMITS: LimiterOptions = {
  limit: 10,
  windowMs: 60_000,
  blockMs: 60_000,
  maxSources: 10_000,
};

interface Entry {
  /** The times of the most recent refusals, oldest first, at most `limit` of them. */
  recent: number[];
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

  /** Counts one refused request. */
  recordBad(source: string, now: number): void {
    const entry = this.#sources.get(source) ?? { recent: [], blockedUntil: 0 };
    entry.recent.push(now);
    if (entry.recent.length > this.#options.limit) {
      entry.recent.shift();
    }
    // Blocked when the last `limit` refusals all fall within one window,
    // wherever that window starts.
    const oldest = entry.recent[0] as number;
    if (entry.recent.length === this.#options.limit && now - oldest < this.#options.windowMs) {
      entry.blockedUntil = now + this.#options.blockMs;
      entry.recent = [];
    }
    // Set again so that the map's order is the order of last use.
    this.#sources.delete(source);
    this.#sources.set(source, entry);
    if (this.#sources.size > this.#options.maxSources) {
      this.#forgetOne(now, source);
    }
  }

  /**
   * Forgets one source other than the one just counted: an unblocked one if
   * there is any, so that a blocked source is kept as long as possible.
   */
  #forgetOne(now: number, keep: string): void {
    let fallback: string | undefined;
    for (const [source, entry] of this.#sources) {
      if (source === keep) {
        continue;
      }
      if (now >= entry.blockedUntil) {
        this.#sources.delete(source);
        return;
      }
      fallback ??= source;
    }
    if (fallback !== undefined) {
      this.#sources.delete(fallback);
    }
  }

  /** How many sources are remembered. For tests. */
  get size(): number {
    return this.#sources.size;
  }
}
