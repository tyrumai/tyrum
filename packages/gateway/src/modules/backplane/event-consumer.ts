/**
 * Consumer-side event deduplication filter.
 *
 * Maintains a set of recently seen event_ids with TTL-based expiry
 * to prevent duplicate event processing in single-instance mode.
 */

export interface EventDedupeOptions {
  /** TTL in milliseconds for seen event IDs. Default: 5 minutes. */
  ttlMs?: number;
  /** Maximum number of entries before forced cleanup. Default: 10000. */
  maxEntries?: number;
}

interface SeenEntry {
  expiresAt: number;
}

export class EventConsumer {
  private readonly seen = new Map<string, SeenEntry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(opts?: EventDedupeOptions) {
    this.ttlMs = opts?.ttlMs ?? 5 * 60 * 1000;
    this.maxEntries = opts?.maxEntries ?? 10_000;
  }

  /**
   * Check whether an event_id has already been seen.
   * If not seen, marks it as seen and returns false (not duplicate).
   * If already seen, returns true (duplicate -- skip processing).
   */
  isDuplicate(eventId: string): boolean {
    const now = Date.now();

    // Cleanup expired entries if we're at capacity
    if (this.seen.size >= this.maxEntries) {
      this.cleanup(now);
    }

    const existing = this.seen.get(eventId);
    if (existing && existing.expiresAt > now) {
      return true;
    }

    this.seen.set(eventId, { expiresAt: now + this.ttlMs });
    return false;
  }

  /**
   * Remove expired entries from the seen set.
   */
  cleanup(now?: number): void {
    const currentTime = now ?? Date.now();
    for (const [id, entry] of this.seen) {
      if (entry.expiresAt <= currentTime) {
        this.seen.delete(id);
      }
    }
  }

  /** Number of currently tracked event IDs. */
  get size(): number {
    return this.seen.size;
  }
}
