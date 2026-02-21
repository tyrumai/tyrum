import { describe, it, expect, beforeEach } from "vitest";
import type { Hono } from "hono";
import { createTestApp } from "./helpers.js";
import { createHash } from "node:crypto";

describe("Approval routes", () => {
  let app: Hono;

  beforeEach(async () => {
    const result = await createTestApp();
    app = result.app;
  });

  it("returns empty list when no approvals exist", async () => {
    const res = await app.request("/approvals");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { approvals: unknown[] };
    expect(body.approvals).toEqual([]);
  });

  it("returns 404 for non-existent approval", async () => {
    const res = await app.request("/approvals/999");
    expect(res.status).toBe(404);
  });

  it("returns 400 for non-numeric approval id", async () => {
    const res = await app.request("/approvals/abc");
    expect(res.status).toBe(400);
  });
});

describe("Approval routes (with DAL access)", () => {
  let app: Hono;
  let container: Awaited<ReturnType<typeof createTestApp>>["container"];
  let executionEngine: Awaited<ReturnType<typeof createTestApp>>["executionEngine"];

  beforeEach(async () => {
    const result = await createTestApp();
    app = result.app;
    container = result.container;
    executionEngine = result.executionEngine;
  });

  it("creates an approval via DAL, lists it via route", async () => {
    await container.approvalDal.create({
      planId: "plan-1",
      stepIndex: 0,
      prompt: "Allow web scrape?",
      context: { url: "https://example.com" },
    });

    const res = await app.request("/approvals");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      approvals: Array<{ plan_id: string; prompt: string }>;
    };
    expect(body.approvals).toHaveLength(1);
    expect(body.approvals[0]!.plan_id).toBe("plan-1");
    expect(body.approvals[0]!.prompt).toBe("Allow web scrape?");
  });

  it("gets a single approval by id", async () => {
    const created = await container.approvalDal.create({
      planId: "plan-1",
      stepIndex: 0,
      prompt: "Approve?",
    });

    const res = await app.request(`/approvals/${String(created.id)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      approval: { id: number; plan_id: string };
    };
    expect(body.approval.id).toBe(created.id);
  });

  it("responds to a pending approval (approve)", async () => {
    const created = await container.approvalDal.create({
      planId: "plan-1",
      stepIndex: 0,
      prompt: "Approve?",
    });

    const res = await app.request(`/approvals/${String(created.id)}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved: true, reason: "looks safe" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      approval: { status: string; response_reason: string };
      applied?: unknown;
    };
    expect(body.approval.status).toBe("approved");
    expect(body.approval.response_reason).toBe("looks safe");
  });

  it("responds to a pending approval (deny)", async () => {
    const created = await container.approvalDal.create({
      planId: "plan-1",
      stepIndex: 0,
      prompt: "Approve?",
    });

    const res = await app.request(`/approvals/${String(created.id)}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved: false, reason: "too risky" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      approval: { status: string; response_reason: string };
      applied?: unknown;
    };
    expect(body.approval.status).toBe("denied");
    expect(body.approval.response_reason).toBe("too risky");
  });

  it("returns 409 when responding with a conflicting decision", async () => {
    const created = await container.approvalDal.create({
      planId: "plan-1",
      stepIndex: 0,
      prompt: "Approve?",
    });

    await app.request(`/approvals/${String(created.id)}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved: true }),
    });

    const res = await app.request(`/approvals/${String(created.id)}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved: false }),
    });

    expect(res.status).toBe(409);
  });

  it("returns 400 when approved field is missing", async () => {
    const created = await container.approvalDal.create({
      planId: "plan-1",
      stepIndex: 0,
      prompt: "Approve?",
    });

    const res = await app.request(`/approvals/${String(created.id)}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "no approved field" }),
    });

    expect(res.status).toBe(400);
  });

  it("applies approval decision by resuming a paused execution run", async () => {
    const bundle = {
      version: 1,
      tools: { allow: [], deny: [], require_approval: [], default: "allow" },
      actions: { allow: [], deny: [], require_approval: ["Http"], default: "allow" },
      network: {
        egress: {
          allow_hosts: ["*"],
          deny_hosts: [],
          require_approval_hosts: [],
          default: "require_approval",
        },
      },
      secrets: {
        resolve: {
          allow: [],
          deny: [],
          require_approval: ["*"],
          default: "require_approval",
        },
      },
    };
    const contentJson = JSON.stringify(bundle);
    const contentHash = createHash("sha256").update(contentJson, "utf-8").digest("hex");
    const nowIso = new Date().toISOString();

    await container.db.run(
      `INSERT INTO policy_bundles (
         scope_kind,
         scope_id,
         version,
         format,
         content_json,
         content_hash,
         updated_at
       ) VALUES ('deployment', 'default', 1, 'json', ?, ?, ?)
       ON CONFLICT (scope_kind, scope_id) DO UPDATE SET
         version = excluded.version,
         format = excluded.format,
         content_json = excluded.content_json,
         content_hash = excluded.content_hash,
         updated_at = excluded.updated_at`,
      [contentJson, contentHash, nowIso],
    );

    const { runId } = await executionEngine.enqueuePlan({
      key: "hook:00000000-0000-4000-8000-000000000001",
      lane: "main",
      planId: "plan-approval-apply-1",
      requestId: "test-req-apply-1",
      steps: [{ type: "Http", args: { url: "https://example.com" } }],
    });

    await executionEngine.workerTick({
      workerId: "w1",
      executor: {
        execute: async () => {
          return { success: true, result: { ok: true } };
        },
      },
    });

    const pending = await container.approvalDal.getPending();
    expect(pending).toHaveLength(1);
    const approval = pending[0]!;

    const paused = await container.db.get<{ status: string }>(
      "SELECT status FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(paused!.status).toBe("paused");

    const res = await app.request(`/approvals/${String(approval.id)}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approved" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { applied?: { resumed_run_id?: string } };
    expect(body.applied?.resumed_run_id).toBe(runId);

    const run = await container.db.get<{ status: string }>(
      "SELECT status FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(run!.status).toBe("queued");
  });

  it("previews an approval context", async () => {
    const created = await container.approvalDal.create({
      planId: "plan-1",
      stepIndex: 2,
      prompt: "Approve payment?",
      context: { amount: 100, currency: "USD" },
    });

    const res = await app.request(`/approvals/${String(created.id)}/preview`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      prompt: string;
      context: { amount: number; currency: string };
      status: string;
    };
    expect(body.prompt).toBe("Approve payment?");
    expect(body.context).toEqual({ amount: 100, currency: "USD" });
    expect(body.status).toBe("pending");
  });

  it("approved approvals are excluded from pending list", async () => {
    const a1 = await container.approvalDal.create({
      planId: "plan-1",
      stepIndex: 0,
      prompt: "First?",
    });
    await container.approvalDal.create({
      planId: "plan-1",
      stepIndex: 1,
      prompt: "Second?",
    });

    await container.approvalDal.respond(a1.id, true);

    const res = await app.request("/approvals");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      approvals: Array<{ prompt: string }>;
    };
    expect(body.approvals).toHaveLength(1);
    expect(body.approvals[0]!.prompt).toBe("Second?");
  });
});
