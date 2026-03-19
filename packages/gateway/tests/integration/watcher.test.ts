import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import mitt from "mitt";
import { createHmac, randomUUID } from "node:crypto";
import { MemoryDal } from "../../src/modules/memory/memory-dal.js";
import { WatcherProcessor } from "../../src/modules/watcher/processor.js";
import { WatcherScheduler } from "../../src/modules/watcher/scheduler.js";
import { createWatcherRoutes } from "../../src/routes/watcher.js";
import type { GatewayEvents } from "../../src/event-bus.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import type { SecretProvider } from "../../src/modules/secret/provider.js";
import type { SecretHandle } from "@tyrum/contracts";

const WEBHOOK_SIGNATURE_HEADER = "x-tyrum-webhook-signature";
const WEBHOOK_TIMESTAMP_HEADER = "x-tyrum-webhook-timestamp";
const WEBHOOK_NONCE_HEADER = "x-tyrum-webhook-nonce";

function computeWebhookSignature(
  secret: string,
  timestamp: string,
  nonce: string,
  body: string,
): string {
  const digest = createHmac("sha256", secret)
    .update(timestamp)
    .update(".")
    .update(nonce)
    .update(".")
    .update(body)
    .digest("hex");
  return `sha256=${digest}`;
}

class InMemorySecretProvider implements SecretProvider {
  private readonly handles = new Map<
    string,
    {
      handle: SecretHandle;
      value: string;
    }
  >();

  async resolve(handle: SecretHandle): Promise<string | null> {
    return this.handles.get(handle.handle_id)?.value ?? null;
  }

  async store(secretKey: string, value: string): Promise<SecretHandle> {
    const handle: SecretHandle = {
      handle_id: secretKey,
      provider: "db",
      scope: secretKey,
      created_at: new Date().toISOString(),
    };
    this.handles.set(handle.handle_id, { handle, value });
    return handle;
  }

  async revoke(handleId: string): Promise<boolean> {
    return this.handles.delete(handleId);
  }

  async list(): Promise<SecretHandle[]> {
    return [...this.handles.values()].map((entry) => entry.handle);
  }
}

describe("Watcher routes + scheduler integration", () => {
  let db: SqliteDb;
  let didOpenDb = false;
  let memoryDal: MemoryDal;
  let eventBus: ReturnType<typeof mitt<GatewayEvents>>;
  let processor: WatcherProcessor;
  let secretProvider: InMemorySecretProvider;
  let app: Hono;

  async function createWebhookWatcher(
    secretValue: string,
    maxSkewMs = 60_000,
    agentId = "default",
  ): Promise<string> {
    const handle = await secretProvider.store(`watcher-webhook-${randomUUID()}`, secretValue);
    const res = await app.request("/watchers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan_id: "plan-webhook",
        trigger_type: "webhook",
        trigger_config: {
          secret_handle: handle,
          max_skew_ms: maxSkewMs,
          agent_key: agentId,
        },
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { watcher_id: string };
    return body.watcher_id;
  }

  beforeEach(() => {
    didOpenDb = false;
    db = openTestSqliteDb();
    didOpenDb = true;
    memoryDal = new MemoryDal(db);
    eventBus = mitt<GatewayEvents>();
    processor = new WatcherProcessor({ db, memoryDal, eventBus });
    secretProvider = new InMemorySecretProvider();
    app = new Hono();
    app.route(
      "/",
      createWatcherRoutes(processor, {
        secretProviderForTenant: () => secretProvider,
      }),
    );
  });

  afterEach(async () => {
    if (!didOpenDb) return;
    didOpenDb = false;
    await db.close();
  });

  async function listWatcherEpisodes(): Promise<any[]> {
    const { items } = await memoryDal.list({
      filter: { kinds: ["episode"], provenance: { channels: ["watcher"] } },
      limit: 2000,
    });
    return items;
  }

  it("POST /watchers creates a watcher", async () => {
    const res = await app.request("/watchers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan_id: "plan-1",
        trigger_type: "periodic",
        trigger_config: { intervalMs: 30000 },
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { watcher_id: string; plan_id: string };
    expect(body.watcher_id).toMatch(/^[0-9a-fA-F-]{36}$/);
    expect(body.plan_id).toBe("plan-1");
  });

  it("GET /watchers lists active watchers", async () => {
    await processor.createWatcher("plan-1", "periodic", { intervalMs: 30000 });
    await processor.createWatcher("plan-2", "plan_complete", { planId: "plan-2" });

    const res = await app.request("/watchers", { method: "GET" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      watchers: Array<{ plan_id: string }>;
    };
    expect(body.watchers).toHaveLength(2);
  });

  it("PATCH /watchers/:id deactivates a watcher", async () => {
    const id = await processor.createWatcher("plan-1", "periodic", {
      intervalMs: 30000,
    });

    const res = await app.request(`/watchers/${String(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: false }),
    });

    expect(res.status).toBe(200);
    expect(await processor.listWatchers()).toHaveLength(0);
  });

  it("DELETE /watchers/:id deactivates a watcher", async () => {
    const id = await processor.createWatcher("plan-1", "periodic", {
      intervalMs: 30000,
    });

    const res = await app.request(`/watchers/${String(id)}`, {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    expect(await processor.listWatchers()).toHaveLength(0);
  });

  it("POST /watchers returns 400 for missing fields", async () => {
    const res = await app.request("/watchers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan_id: "plan-1" }),
    });

    expect(res.status).toBe(400);
  });

  it("create watcher via route, fire periodic trigger via scheduler", async () => {
    // Create a periodic watcher via the route
    const createRes = await app.request("/watchers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan_id: "plan-1",
        trigger_type: "periodic",
        trigger_config: { intervalMs: 1000 },
      }),
    });
    expect(createRes.status).toBe(201);

    // Fire a scheduler tick
    const scheduler = new WatcherScheduler({
      db,
      memoryDal,
      eventBus,
      tickMs: 100,
    });
    await scheduler.tick();

    const episodes = await listWatcherEpisodes();
    expect(
      episodes.filter((e) => (e?.provenance?.metadata as any)?.event_type === "periodic_fired"),
    ).toHaveLength(1);
  });

  it("POST /watchers/:id/trigger/webhook rejects requests without signature envelope", async () => {
    const watcherId = await createWebhookWatcher("super-secret");

    const res = await app.request(`/watchers/${String(watcherId)}/trigger/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
    });

    expect(res.status).toBe(401);
  });

  it("POST /watchers/:id/trigger/webhook accepts a valid signed request and rejects nonce replay", async () => {
    const secret = "super-secret";
    const watcherId = await createWebhookWatcher(secret, 120_000);
    const payload = JSON.stringify({ hello: "world" });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = "nonce-123";
    const signature = computeWebhookSignature(secret, timestamp, nonce, payload);

    const first = await app.request(`/watchers/${String(watcherId)}/trigger/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [WEBHOOK_SIGNATURE_HEADER]: signature,
        [WEBHOOK_TIMESTAMP_HEADER]: timestamp,
        [WEBHOOK_NONCE_HEADER]: nonce,
      },
      body: payload,
    });

    expect(first.status).toBe(202);
    expect((await first.json()) as { ok: boolean }).toEqual({ ok: true });

    const replay = await app.request(`/watchers/${String(watcherId)}/trigger/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [WEBHOOK_SIGNATURE_HEADER]: signature,
        [WEBHOOK_TIMESTAMP_HEADER]: timestamp,
        [WEBHOOK_NONCE_HEADER]: nonce,
      },
      body: payload,
    });

    expect(replay.status).toBe(409);
    const episodes = await listWatcherEpisodes();
    expect(
      episodes.filter((e) => (e?.provenance?.metadata as any)?.event_type === "webhook_fired"),
    ).toHaveLength(1);
  });

  it("POST /watchers/:id/trigger/webhook rejects nonce replays even if timestamp unit differs", async () => {
    const secret = "super-secret";
    const watcherId = await createWebhookWatcher(secret, 120_000);
    const payload = JSON.stringify({ hello: "world" });
    let timestampMs = Date.now();
    if (timestampMs % 1000 === 0) timestampMs += 1;

    const nonce = "nonce-units";

    const timestampHeaderMs = String(timestampMs);
    const signatureMs = computeWebhookSignature(secret, timestampHeaderMs, nonce, payload);

    const first = await app.request(`/watchers/${String(watcherId)}/trigger/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [WEBHOOK_SIGNATURE_HEADER]: signatureMs,
        [WEBHOOK_TIMESTAMP_HEADER]: timestampHeaderMs,
        [WEBHOOK_NONCE_HEADER]: nonce,
      },
      body: payload,
    });
    expect(first.status).toBe(202);

    const timestampHeaderSeconds = String(Math.floor(timestampMs / 1000));
    const signatureSeconds = computeWebhookSignature(
      secret,
      timestampHeaderSeconds,
      nonce,
      payload,
    );
    const replay = await app.request(`/watchers/${String(watcherId)}/trigger/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [WEBHOOK_SIGNATURE_HEADER]: signatureSeconds,
        [WEBHOOK_TIMESTAMP_HEADER]: timestampHeaderSeconds,
        [WEBHOOK_NONCE_HEADER]: nonce,
      },
      body: payload,
    });
    expect(replay.status).toBe(409);
  });

  it("POST /watchers/:id/trigger/webhook rejects nonces containing '.' to avoid signature ambiguity", async () => {
    const secret = "super-secret";
    const watcherId = await createWebhookWatcher(secret, 120_000);
    const payload = "c";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = "a.b";
    const signature = computeWebhookSignature(secret, timestamp, nonce, payload);

    const res = await app.request(`/watchers/${String(watcherId)}/trigger/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        [WEBHOOK_SIGNATURE_HEADER]: signature,
        [WEBHOOK_TIMESTAMP_HEADER]: timestamp,
        [WEBHOOK_NONCE_HEADER]: nonce,
      },
      body: payload,
    });

    expect(res.status).toBe(401);
  });

  it("POST /watchers/:id/trigger/webhook uses watcher-configured agent_key for secret resolution", async () => {
    const agentA = "agent-a";

    const secretA = "secret-a";
    const watcherId = await createWebhookWatcher(secretA, 120_000, agentA);
    const payload = JSON.stringify({ hello: "world" });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = "nonce-agent";
    const signature = computeWebhookSignature(secretA, timestamp, nonce, payload);

    const res = await app.request(`/watchers/${String(watcherId)}/trigger/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [WEBHOOK_SIGNATURE_HEADER]: signature,
        [WEBHOOK_TIMESTAMP_HEADER]: timestamp,
        [WEBHOOK_NONCE_HEADER]: nonce,
      },
      body: payload,
    });

    expect(res.status).toBe(202);
  });

  it("POST /watchers/:id/trigger/webhook rejects stale timestamps", async () => {
    const secret = "super-secret";
    const watcherId = await createWebhookWatcher(secret, 60_000);
    const payload = JSON.stringify({ hello: "world" });
    const timestamp = String(Math.floor((Date.now() - 5 * 60_000) / 1000));
    const nonce = "nonce-stale";
    const signature = computeWebhookSignature(secret, timestamp, nonce, payload);

    const res = await app.request(`/watchers/${String(watcherId)}/trigger/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [WEBHOOK_SIGNATURE_HEADER]: signature,
        [WEBHOOK_TIMESTAMP_HEADER]: timestamp,
        [WEBHOOK_NONCE_HEADER]: nonce,
      },
      body: payload,
    });

    expect(res.status).toBe(401);
    const episodes = await listWatcherEpisodes();
    expect(
      episodes.filter((e) => (e?.provenance?.metadata as any)?.event_type === "webhook_fired"),
    ).toHaveLength(0);
  });
});
