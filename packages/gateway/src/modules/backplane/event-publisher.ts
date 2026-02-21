/**
 * Typed gateway event publisher.
 *
 * Wraps OutboxDal.enqueue() with a typed GatewayEvent envelope,
 * automatic event_id generation, and the `gateway.event` topic.
 */

import { randomUUID } from "node:crypto";
import type { OutboxDal } from "./outbox-dal.js";

/** Topic constant for gateway events routed through the outbox. */
export const GATEWAY_EVENT_TOPIC = "gateway.event" as const;

/**
 * Lightweight gateway event envelope.
 *
 * Intentionally decoupled from the Zod schemas so the publisher
 * can be used in worker/scheduler roles that don't import the full schema package.
 */
export interface GatewayEventMessage {
  event_id: string;
  kind: string;
  occurred_at: string;
  payload: unknown;
}

export class EventPublisher {
  constructor(private readonly outboxDal: OutboxDal) {}

  /**
   * Publish a typed gateway event through the outbox.
   *
   * @param kind - The event kind (e.g., "run.started", "presence.online")
   * @param payload - Event-specific payload
   * @param opts - Optional target edge ID for directed events
   * @returns The generated event_id
   */
  async publish(
    kind: string,
    payload: unknown,
    opts?: { targetEdgeId?: string },
  ): Promise<string> {
    const eventId = randomUUID();
    const message: GatewayEventMessage = {
      event_id: eventId,
      kind,
      occurred_at: new Date().toISOString(),
      payload,
    };

    await this.outboxDal.enqueue(GATEWAY_EVENT_TOPIC, message, {
      targetEdgeId: opts?.targetEdgeId ?? null,
    });

    return eventId;
  }
}
