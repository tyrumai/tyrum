import { describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";

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
    expect(body["auth"]).toEqual({ enabled: true });
    expect(body["ws"]).toBeNull();
    expect("auth_profiles" in body).toBe(false);
    expect(body["model_auth"]).toBeTypeOf("object");
    expect((body["model_auth"] as Record<string, unknown>)["auth_profiles"]).toBeTypeOf("object");
    expect(body["catalog_freshness"]).toBeTypeOf("object");
    expect(body["conversations"]).toBeInstanceOf(Array);
    expect(body["queue_depth"]).toBeTypeOf("object");
    expect(body["sandbox"]).toBeTypeOf("object");
    expect(body["config_health"]).toBeTypeOf("object");
    expect((body["config_health"] as { status: string }).status).toBe("issues");
    expect(
      (body["config_health"] as { issues: Array<{ code: string }> }).issues.some(
        (issue) => issue.code === "no_provider_accounts",
      ),
    ).toBe(true);
  });
});
