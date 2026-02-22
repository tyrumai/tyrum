import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createTestContainer } from "./helpers.js";
import { VERSION } from "../../src/version.js";

describe("/presence", () => {
  it("lists gateway self entry and connected peers by stable instance_id", async () => {
    const container = await createTestContainer();

    const nowMs = Date.now();
    await container.presenceDal.upsert({
      instanceId: "dev_test_1",
      role: "client",
      connectionId: "conn-1",
      host: "local",
      ip: "127.0.0.1",
      version: "0.0.0-test",
      mode: "cli",
      metadata: { capabilities: ["cli"], edge_id: "test-instance" },
      nowMs,
      ttlMs: 30_000,
    });

    const app = createApp(container, {
      runtime: {
        version: VERSION,
        instanceId: "test-instance",
        role: "all",
        otelEnabled: false,
      },
    });

    const res = await app.request("/presence");
    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      status: string;
      entries: Array<Record<string, unknown>>;
    };

    expect(payload.status).toBe("ok");
    expect(payload.entries.length).toBe(2);

    const gateway = payload.entries[0]!;
    expect(gateway["role"]).toBe("gateway");
    expect(gateway["instance_id"]).toBe("test-instance");
    expect(gateway["version"]).toBe(VERSION);

    const peer = payload.entries.find((e) => e["role"] === "client")!;
    expect(peer["instance_id"]).toBe("dev_test_1");
    expect(peer["host"]).toBe("local");
    expect(peer["ip"]).toBe("127.0.0.1");
    expect(peer["version"]).toBe("0.0.0-test");
    expect(peer["mode"]).toBe("cli");
    expect(typeof peer["last_seen_at"]).toBe("string");

    await container.db.close();
  });
});
