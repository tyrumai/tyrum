import type { DedupeDal } from "./dedupe-dal.js";

export interface NormalizedMessage {
  message_id: string;
  channel: string;
  thread_id: string;
  text: string;
  sender?: string;
  timestamp?: string;
}

export interface ConnectorPipelineOpts {
  dedupeDal: DedupeDal;
  dedupeTtlMs?: number;
  debounceDurationMs?: number;
}

export class ConnectorPipeline {
  private readonly dedupeDal: DedupeDal;
  private readonly dedupeTtlMs: number;
  private readonly debounceDurationMs: number;
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly pendingMessages = new Map<string, NormalizedMessage>();
  private readonly pendingResolvers = new Map<
    string,
    (value: NormalizedMessage | null) => void
  >();

  constructor(opts: ConnectorPipelineOpts) {
    this.dedupeDal = opts.dedupeDal;
    this.dedupeTtlMs = opts.dedupeTtlMs ?? 3_600_000; // 1 hour default
    this.debounceDurationMs = opts.debounceDurationMs ?? 0; // no debounce by default
  }

  /**
   * Ingest a normalized message through the pipeline.
   * Returns the message if it should be processed, or null if filtered (duplicate/debounced).
   */
  async ingest(message: NormalizedMessage): Promise<NormalizedMessage | null> {
    // Step 1: Deduplicate
    const isDup = await this.dedupeDal.isDuplicate(
      message.message_id,
      message.channel,
    );
    if (isDup) return null;

    // Record for future dedup
    await this.dedupeDal.record(
      message.message_id,
      message.channel,
      this.dedupeTtlMs,
    );

    // Step 2: Debounce (if configured)
    if (this.debounceDurationMs > 0) {
      return this.debounce(message);
    }

    return message;
  }

  private debounce(
    message: NormalizedMessage,
  ): Promise<NormalizedMessage | null> {
    const key = `${message.channel}:${message.thread_id}`;

    // Cancel any existing timer and resolve the superseded promise with null
    const existingTimer = this.debounceTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
      const prevResolver = this.pendingResolvers.get(key);
      if (prevResolver) {
        prevResolver(null);
      }
    }

    // Store the latest message
    this.pendingMessages.set(key, message);

    return new Promise((resolve) => {
      this.pendingResolvers.set(key, resolve);

      const timer = setTimeout(() => {
        const pending = this.pendingMessages.get(key);
        this.pendingMessages.delete(key);
        this.debounceTimers.delete(key);
        this.pendingResolvers.delete(key);
        resolve(pending ?? null);
      }, this.debounceDurationMs);

      timer.unref();
      this.debounceTimers.set(key, timer);
    });
  }

  /** Clean up expired dedupe records. */
  async cleanup(): Promise<number> {
    return this.dedupeDal.cleanup();
  }
}
