import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestApp } from "./helpers.js";
import { createContainer } from "../../src/container.js";
import { loadConfig } from "../../src/config.js";
import { createApp } from "../../src/app.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

describe("GET /status", () => {
  it("returns expanded observability status information", async () => {
    const { app } = await createTestApp();

    const res = await app.request("/status");
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body["status"]).toBe("ok");
    expect(body["version"]).toBeTypeOf("string");
    expect(body["instance_id"]).toBe("test-instance");
    expect(body["role"]).toBe("all");
    expect(body["db_kind"]).toBe("sqlite");
    expect(body["is_exposed"]).toBe(false);
    expect(body["otel_enabled"]).toBe(false);
    expect(body["ws"]).toBeNull();
    expect("auth_profiles" in body).toBe(false);
    expect(body["model_auth"]).toBeTypeOf("object");
    expect((body["model_auth"] as Record<string, unknown>)["auth_profiles"]).toBeTypeOf("object");
    expect(body["catalog_freshness"]).toBeTypeOf("object");
    expect(body["session_lanes"]).toBeInstanceOf(Array);
    expect(body["queue_depth"]).toBeTypeOf("object");
    expect(body["sandbox"]).toBeTypeOf("object");
  });

  it("defaults runtime fields from gateway config when not provided", async () => {
    const prevInstanceId = process.env["TYRUM_INSTANCE_ID"];
    const prevRole = process.env["TYRUM_ROLE"];

    process.env["TYRUM_INSTANCE_ID"] = "env-instance";
    process.env["TYRUM_ROLE"] = "worker";

    try {
      const gatewayConfig = loadConfig({
        GATEWAY_TOKEN: "test-token",
        TYRUM_INSTANCE_ID: "cfg-instance",
        TYRUM_ROLE: "edge",
      });
      const container = createContainer({ dbPath: ":memory:", migrationsDir }, { gatewayConfig });
      try {
        const app = createApp(container);
        const res = await app.request("/status");
        expect(res.status).toBe(200);

        const body = (await res.json()) as Record<string, unknown>;
        expect(body["instance_id"]).toBe("cfg-instance");
        expect(body["role"]).toBe("edge");
      } finally {
        await container.db.close();
      }
    } finally {
      if (prevInstanceId === undefined) delete process.env["TYRUM_INSTANCE_ID"];
      else process.env["TYRUM_INSTANCE_ID"] = prevInstanceId;

      if (prevRole === undefined) delete process.env["TYRUM_ROLE"];
      else process.env["TYRUM_ROLE"] = prevRole;
    }
  });
});
