import type { SqlDb } from "../../statestore/types.js";
import type { EventPublisher } from "../backplane/event-publisher.js";

export interface OutboundMessage {
  idempotency_key: string;
  channel: string;
  payload: unknown;
}

export interface OutboundResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

export class OutboundSender {
  private readonly eventPublisher?: EventPublisher;

  constructor(
    private readonly db: SqlDb,
    opts?: { eventPublisher?: EventPublisher },
  ) {
    this.eventPublisher = opts?.eventPublisher;
  }

  /**
   * Send a message with idempotency. If the key was already used successfully,
   * return the cached result without re-sending.
   */
  async send(
    message: OutboundMessage,
    sendFn: (payload: unknown) => Promise<unknown>,
  ): Promise<OutboundResult> {
    // Check if already completed
    const existing = await this.db.get<{
      status: string;
      result_json: string | null;
    }>(
      "SELECT status, result_json FROM outbound_idempotency WHERE idempotency_key = ? AND channel = ?",
      [message.idempotency_key, message.channel],
    );

    if (existing?.status === "completed" && existing.result_json) {
      try {
        return {
          success: true,
          result: JSON.parse(existing.result_json) as unknown,
        };
      } catch {
        return { success: true };
      }
    }

    // Record attempt
    if (!existing) {
      await this.db.run(
        "INSERT INTO outbound_idempotency (idempotency_key, channel) VALUES (?, ?)",
        [message.idempotency_key, message.channel],
      );
    }

    // Execute send
    try {
      const result = await sendFn(message.payload);
      const nowIso = new Date().toISOString();
      await this.db.run(
        "UPDATE outbound_idempotency SET status = 'completed', completed_at = ?, result_json = ? WHERE idempotency_key = ? AND channel = ?",
        [nowIso, JSON.stringify(result ?? null), message.idempotency_key, message.channel],
      );

      void this.eventPublisher?.publish("message.outbound", {
        channel: message.channel,
        idempotency_key: message.idempotency_key,
      }).catch(() => {});

      return { success: true, result };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await this.db.run(
        "UPDATE outbound_idempotency SET status = 'failed' WHERE idempotency_key = ? AND channel = ?",
        [message.idempotency_key, message.channel],
      );
      return { success: false, error: errorMsg };
    }
  }
}
