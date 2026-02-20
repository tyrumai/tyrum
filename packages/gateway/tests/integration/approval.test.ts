import { describe, it, expect, beforeEach } from "vitest";
import type { Hono } from "hono";
import { createTestApp } from "./helpers.js";

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

  beforeEach(async () => {
    const result = await createTestApp();
    app = result.app;
    container = result.container;
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
    };
    expect(body.approval.status).toBe("denied");
    expect(body.approval.response_reason).toBe("too risky");
  });

  it("returns 404 when responding to already-responded approval", async () => {
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

    expect(res.status).toBe(404);
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
