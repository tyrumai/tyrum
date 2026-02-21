import { afterEach, describe, expect, it } from "vitest";
import { OutboundSender } from "../../src/modules/connector/outbound.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("OutboundSender", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  function createSender(): OutboundSender {
    db = openTestSqliteDb();
    return new OutboundSender(db);
  }

  it("sends successfully and records result", async () => {
    const sender = createSender();
    const result = await sender.send(
      { idempotency_key: "key-1", channel: "telegram", payload: { text: "hi" } },
      async (payload) => ({ sent: true, payload }),
    );

    expect(result.success).toBe(true);
    expect(result.result).toEqual({ sent: true, payload: { text: "hi" } });
  });

  it("returns cached result on second call (idempotent)", async () => {
    const sender = createSender();
    let callCount = 0;
    const sendFn = async (payload: unknown) => {
      callCount++;
      return { sent: true, payload };
    };

    const msg = { idempotency_key: "key-1", channel: "telegram", payload: { text: "hi" } };

    await sender.send(msg, sendFn);
    const result = await sender.send(msg, sendFn);

    expect(result.success).toBe(true);
    expect(result.result).toEqual({ sent: true, payload: { text: "hi" } });
    // sendFn should only be called once
    expect(callCount).toBe(1);
  });

  it("records failure status on send error", async () => {
    const sender = createSender();
    const result = await sender.send(
      { idempotency_key: "key-fail", channel: "telegram", payload: {} },
      async () => {
        throw new Error("network error");
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("network error");
  });

  it("retries after failure (does not cache failed sends)", async () => {
    const sender = createSender();
    let attempt = 0;
    const sendFn = async (payload: unknown) => {
      attempt++;
      if (attempt === 1) throw new Error("transient failure");
      return { sent: true, payload };
    };

    const msg = { idempotency_key: "key-retry", channel: "telegram", payload: { text: "hi" } };

    const r1 = await sender.send(msg, sendFn);
    expect(r1.success).toBe(false);

    const r2 = await sender.send(msg, sendFn);
    expect(r2.success).toBe(true);
    expect(r2.result).toEqual({ sent: true, payload: { text: "hi" } });
  });

  it("treats different channels as separate idempotency scopes", async () => {
    const sender = createSender();
    let callCount = 0;
    const sendFn = async () => {
      callCount++;
      return { ok: true };
    };

    await sender.send(
      { idempotency_key: "key-1", channel: "telegram", payload: {} },
      sendFn,
    );
    await sender.send(
      { idempotency_key: "key-1", channel: "discord", payload: {} },
      sendFn,
    );

    // Both should call sendFn since they are different channels
    expect(callCount).toBe(2);
  });
});
