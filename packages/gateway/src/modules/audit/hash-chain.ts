import { createHash } from "node:crypto";
import type { AuditEvent, ReceiptBundle, ChainVerification } from "@tyrum/schemas";

export interface HashableEvent {
  plan_id: string;
  step_index: number;
  occurred_at: string;
  action: string;
}

export interface ChainableEvent extends HashableEvent {
  id: number;
  prev_hash: string | null;
  event_hash: string | null;
}

function parseJsonOrThrow(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (err) {
    throw new Error("invalid audit event action JSON", { cause: err });
  }
}

/** Compute SHA-256 hash of event data + previous hash for chain integrity. */
export function computeEventHash(eventData: HashableEvent, prevHash: string | null): string {
  const canonical = JSON.stringify({
    action: eventData.action,
    occurred_at: eventData.occurred_at,
    plan_id: eventData.plan_id,
    prev_hash: prevHash,
    step_index: eventData.step_index,
  }); // keys sorted alphabetically
  return createHash("sha256").update(canonical).digest("hex");
}

/** Verify integrity of an event chain. */
export function verifyChain(events: ChainableEvent[]): {
  valid: boolean;
  checked_count: number;
  broken_at_index: number | null;
  broken_at_id: number | null;
} {
  let checkedCount = 0;
  let prevHash: string | null = null;

  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;

    if (event.event_hash === null) {
      return {
        valid: false,
        checked_count: checkedCount,
        broken_at_index: i,
        broken_at_id: event.id,
      };
    }

    const expected = computeEventHash(event, event.prev_hash);
    checkedCount++;

    if (event.event_hash !== expected) {
      return {
        valid: false,
        checked_count: checkedCount,
        broken_at_index: i,
        broken_at_id: event.id,
      };
    }

    // Verify prev_hash linkage: should match the previous hashed event's event_hash
    if (prevHash !== null && event.prev_hash !== prevHash) {
      return {
        valid: false,
        checked_count: checkedCount,
        broken_at_index: i,
        broken_at_id: event.id,
      };
    }

    prevHash = event.event_hash;
  }

  return {
    valid: true,
    checked_count: checkedCount,
    broken_at_index: null,
    broken_at_id: null,
  };
}

/** Build a ReceiptBundle from chainable events for a given plan. */
export function exportReceiptBundle(planId: string, events: ChainableEvent[]): ReceiptBundle {
  const verification: ChainVerification = verifyChain(events);

  const auditEvents: AuditEvent[] = events.map((e) => ({
    id: e.id,
    plan_id: e.plan_id,
    step_index: e.step_index,
    occurred_at: e.occurred_at,
    action: parseJsonOrThrow(e.action),
    prev_hash: e.prev_hash,
    event_hash: e.event_hash,
  }));

  return {
    plan_id: planId,
    events: auditEvents,
    chain_verification: verification,
    exported_at: new Date().toISOString(),
  };
}
