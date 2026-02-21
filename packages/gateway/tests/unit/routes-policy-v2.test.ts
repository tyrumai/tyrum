import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createPolicyV2Routes } from "../../src/routes/policy-v2.js";

describe("policy-v2 routes", () => {
  const sampleBundles = [
    { id: "bundle-1", name: "default", version: 1 },
  ];
  const sampleRules = [
    { domain: "*.example.com", action: "allow" },
    { domain: "evil.net", action: "deny" },
  ];
  const sampleSnapshot = {
    snapshot_id: "snap-1",
    run_id: "run-1",
    bundle_json: JSON.stringify({ rules: sampleRules }),
    created_at: "2025-06-01T00:00:00Z",
  };
  const sampleEvalResult = {
    decision: "allow",
    matched_rules: [sampleRules[0]],
  };

  function setup(overrides: {
    getBundles?: unknown[];
    getMergedRules?: unknown[];
    evaluate?: unknown;
    getByRunId?: unknown;
  } = {}) {
    const bundleManager = {
      getBundles: vi.fn().mockReturnValue(overrides.getBundles ?? sampleBundles),
      getMergedRules: vi.fn().mockReturnValue(overrides.getMergedRules ?? sampleRules),
      evaluate: vi.fn().mockReturnValue(overrides.evaluate ?? sampleEvalResult),
    };
    const snapshotDal = {
      getByRunId: vi.fn().mockResolvedValue(
        overrides.getByRunId === null ? undefined : (overrides.getByRunId ?? sampleSnapshot),
      ),
    };
    const app = new Hono();
    app.route("/", createPolicyV2Routes({ bundleManager, snapshotDal } as never));
    return { app, bundleManager, snapshotDal };
  }

  // --- GET /policy/bundle ---

  it("GET /policy/bundle returns bundles and merged rules", async () => {
    const { app } = setup();
    const res = await app.request("/policy/bundle");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bundles: unknown[]; merged_rules: unknown[] };
    expect(body.bundles).toEqual(sampleBundles);
    expect(body.merged_rules).toEqual(sampleRules);
  });

  // --- GET /policy/snapshot/:run_id ---

  it("GET /policy/snapshot/:run_id returns snapshot with parsed bundle", async () => {
    const { app } = setup();
    const res = await app.request("/policy/snapshot/run-1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      snapshot_id: string;
      run_id: string;
      bundle: unknown;
      created_at: string;
    };
    expect(body.snapshot_id).toBe("snap-1");
    expect(body.run_id).toBe("run-1");
    expect(body.bundle).toEqual({ rules: sampleRules });
    expect(body.created_at).toBe("2025-06-01T00:00:00Z");
  });

  it("GET /policy/snapshot/:run_id returns 404 when not found", async () => {
    const { app } = setup({ getByRunId: null });
    const res = await app.request("/policy/snapshot/missing");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  it("GET /policy/snapshot/:run_id handles invalid bundle_json gracefully", async () => {
    const { app } = setup({
      getByRunId: {
        snapshot_id: "snap-bad",
        run_id: "run-bad",
        bundle_json: "not-valid-json{{{",
        created_at: "2025-06-01T00:00:00Z",
      },
    });
    const res = await app.request("/policy/snapshot/run-bad");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bundle: unknown };
    expect(body.bundle).toBeNull();
  });

  // --- POST /policy/evaluate ---

  it("POST /policy/evaluate evaluates domain", async () => {
    const { app, bundleManager } = setup();
    const res = await app.request("/policy/evaluate", {
      method: "POST",
      body: JSON.stringify({ domain: "foo.example.com", context: { user: "alice" } }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof sampleEvalResult;
    expect(body.decision).toBe("allow");
    expect(bundleManager.evaluate).toHaveBeenCalledWith("foo.example.com", { user: "alice" });
  });

  it("POST /policy/evaluate returns 400 when domain missing", async () => {
    const { app } = setup();
    const res = await app.request("/policy/evaluate", {
      method: "POST",
      body: JSON.stringify({ context: {} }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_request");
  });
});
