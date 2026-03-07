import { WsDeliveryReceiptEvent } from "@tyrum/schemas";
import { expect, it, vi } from "vitest";
import { normalizeUpdate } from "../../src/modules/ingress/telegram.js";
import {
  makeTelegramUpdate,
  setupTelegramProcessorHarness,
  type TelegramQueueTestState,
} from "./telegram-queue.test-fixtures.js";

async function expectDeliveryReceipt(
  db: TelegramQueueTestState["db"],
  enqueued: {
    inbox: {
      key: string;
      lane: string;
      message_id: number;
      source: string;
      thread_id: string;
    };
  },
  options: {
    error?: { code: string; message: RegExp };
    status: "failed" | "sent";
  },
): Promise<void> {
  const expectedDedupeKey = `${enqueued.inbox.source}:${enqueued.inbox.thread_id}:${enqueued.inbox.message_id}:reply:0`;
  const rows = await db!.all<{ payload_json: string }>(
    "SELECT payload_json FROM outbox WHERE topic = 'ws.broadcast' ORDER BY id ASC",
  );

  expect(rows).toHaveLength(1);

  const envelope = JSON.parse(rows[0]!.payload_json) as { message?: unknown };
  const parsed = WsDeliveryReceiptEvent.safeParse(envelope.message);
  expect(parsed.success).toBe(true);
  if (!parsed.success) return;

  expect(parsed.data.event_id).toBe(`delivery.receipt:${expectedDedupeKey}`);
  expect(parsed.data.payload).toMatchObject({
    session_id: enqueued.inbox.key,
    lane: enqueued.inbox.lane,
    channel: "telegram",
    thread_id: enqueued.inbox.thread_id,
    status: options.status,
    receipt: expect.objectContaining({
      dedupe_key: expectedDedupeKey,
      chunk_index: 0,
    }),
  });

  if (options.error) {
    expect(parsed.data.payload.error).toEqual({
      code: options.error.code,
      message: expect.stringMatching(options.error.message),
    });
  }
}

export function registerTelegramQueueDeliveryReceiptTests(state: TelegramQueueTestState): void {
  it("emits delivery receipt events for outbound sends", async () => {
    const { db, fetchFn, processor, queue } = setupTelegramProcessorHarness(state);
    const enqueued = await queue.enqueue(
      normalizeUpdate(JSON.stringify(makeTelegramUpdate("Help me"))),
    );

    await processor.tick();

    expect(fetchFn).toHaveBeenCalledOnce();
    await expectDeliveryReceipt(db, enqueued, { status: "sent" });
  });

  it("emits failed delivery receipts when no egress connector is registered", async () => {
    const workSend = vi.fn().mockResolvedValue({ ok: true, account: "work" });
    const { db, fetchFn, processor, queue } = setupTelegramProcessorHarness(state, {
      processorOptions: {
        egressConnectors: [{ connector: "telegram", accountId: "work", sendMessage: workSend }],
      },
    });
    const enqueued = await queue.enqueue(
      normalizeUpdate(JSON.stringify(makeTelegramUpdate("Help me"))),
    );

    await processor.tick();

    expect(workSend).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
    await expectDeliveryReceipt(db, enqueued, {
      error: {
        code: "channels.connector_missing",
        message: /no egress connector registered/,
      },
      status: "failed",
    });
  });
}
