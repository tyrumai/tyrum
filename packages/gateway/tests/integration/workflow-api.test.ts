import { describe, expect, it, afterEach } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { createWorkflowRoutes } from "../../src/routes/workflow.js";

describe("workflow API", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    if (db) {
      await db.close();
      db = undefined;
    }
  });

  function setup() {
    db = openTestSqliteDb();
    const app = createWorkflowRoutes({ db });
    return { app, db: db! };
  }

  it("POST /workflow/run creates a run", async () => {
    const { app } = setup();
    const res = await app.request("/workflow/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "agent:test:cli:main",
        steps: [
          {
            kind: "Http",
            description: "test",
            url: "https://example.com",
            method: "GET",
          },
        ],
        trigger: { kind: "api" },
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { job_id: string; run_id: string };
    expect(body.job_id).toBeDefined();
    expect(body.run_id).toBeDefined();
  });

  it("POST /workflow/run rejects empty steps", async () => {
    const { app } = setup();
    const res = await app.request("/workflow/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "test" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /workflow/run rejects missing key", async () => {
    const { app } = setup();
    const res = await app.request("/workflow/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ steps: [{ kind: "Http" }] }),
    });
    expect(res.status).toBe(400);
  });

  it("GET /workflow/runs lists runs", async () => {
    const { app } = setup();
    await app.request("/workflow/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "agent:test:cli:main",
        steps: [
          {
            kind: "Http",
            description: "test",
            url: "https://example.com",
            method: "GET",
          },
        ],
      }),
    });

    const res = await app.request("/workflow/runs");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runs: unknown[] };
    expect(body.runs).toHaveLength(1);
  });

  it("GET /workflow/runs filters by status", async () => {
    const { app } = setup();
    await app.request("/workflow/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "agent:test:cli:main",
        steps: [{ kind: "Http" }],
      }),
    });

    const queuedRes = await app.request("/workflow/runs?status=queued");
    const queuedBody = (await queuedRes.json()) as { runs: unknown[] };
    expect(queuedBody.runs).toHaveLength(1);

    const succeededRes = await app.request("/workflow/runs?status=succeeded");
    const succeededBody = (await succeededRes.json()) as { runs: unknown[] };
    expect(succeededBody.runs).toHaveLength(0);
  });

  it("GET /workflow/runs/:id returns run detail with steps", async () => {
    const { app } = setup();
    const createRes = await app.request("/workflow/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "agent:test:cli:main",
        steps: [
          { kind: "Http", description: "step1", url: "https://example.com", method: "GET" },
          { kind: "Http", description: "step2", url: "https://example.com", method: "POST" },
        ],
      }),
    });
    const { run_id } = (await createRes.json()) as { run_id: string };

    const res = await app.request(`/workflow/runs/${run_id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      run: { run_id: string };
      steps: { step_index: number; action: unknown }[];
    };
    expect(body.run.run_id).toBe(run_id);
    expect(body.steps).toHaveLength(2);
    expect(body.steps[0]!.step_index).toBe(0);
    expect(body.steps[1]!.step_index).toBe(1);
    expect(body.steps[0]!.action).toEqual(
      expect.objectContaining({ kind: "Http", description: "step1" }),
    );
  });

  it("GET /workflow/runs/:id returns 404 for missing run", async () => {
    const { app } = setup();
    const res = await app.request("/workflow/runs/nonexistent");
    expect(res.status).toBe(404);
  });

  it("POST /workflow/cancel cancels a run", async () => {
    const { app } = setup();
    const createRes = await app.request("/workflow/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "agent:test:cli:main",
        steps: [{ kind: "Http", description: "test" }],
      }),
    });
    const { run_id } = (await createRes.json()) as { run_id: string };

    const res = await app.request("/workflow/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cancelled: boolean };
    expect(body.cancelled).toBe(true);

    // Verify run is cancelled
    const detailRes = await app.request(`/workflow/runs/${run_id}`);
    const detail = (await detailRes.json()) as { run: { status: string } };
    expect(detail.run.status).toBe("cancelled");
  });

  it("POST /workflow/cancel returns 404 for missing run", async () => {
    const { app } = setup();
    const res = await app.request("/workflow/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: "nonexistent" }),
    });
    expect(res.status).toBe(404);
  });

  it("POST /workflow/cancel returns 400 without run_id", async () => {
    const { app } = setup();
    const res = await app.request("/workflow/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
