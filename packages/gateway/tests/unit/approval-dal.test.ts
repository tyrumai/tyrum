import { afterEach, describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { migrate } from "../../src/migrate.js";
import { ApprovalDal } from "../../src/modules/approval/dal.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

describe("ApprovalDal", () => {
  let db: Database.Database | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  function createDal(): ApprovalDal {
    db = new Database(":memory:");
    migrate(db, migrationsDir);
    return new ApprovalDal(db);
  }

  it("creates a pending approval", () => {
    const dal = createDal();
    const approval = dal.create({
      planId: "plan-1",
      stepIndex: 0,
      prompt: "Allow web scrape of example.com?",
      context: { url: "https://example.com" },
    });

    expect(approval.id).toBeGreaterThan(0);
    expect(approval.plan_id).toBe("plan-1");
    expect(approval.step_index).toBe(0);
    expect(approval.prompt).toBe("Allow web scrape of example.com?");
    expect(approval.context).toEqual({ url: "https://example.com" });
    expect(approval.status).toBe("pending");
    expect(approval.responded_at).toBeNull();
    expect(approval.response_reason).toBeNull();
  });

  it("retrieves approval by id", () => {
    const dal = createDal();
    const created = dal.create({
      planId: "plan-1",
      stepIndex: 0,
      prompt: "Approve?",
    });

    const fetched = dal.getById(created.id);
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.prompt).toBe("Approve?");
  });

  it("returns undefined for non-existent id", () => {
    const dal = createDal();
    expect(dal.getById(999)).toBeUndefined();
  });

  it("approves a pending approval", () => {
    const dal = createDal();
    const created = dal.create({
      planId: "plan-1",
      stepIndex: 0,
      prompt: "Approve?",
    });

    const updated = dal.respond(created.id, true, "looks safe");
    expect(updated).toBeDefined();
    expect(updated!.status).toBe("approved");
    expect(updated!.response_reason).toBe("looks safe");
    expect(updated!.responded_at).toBeTruthy();
  });

  it("denies a pending approval", () => {
    const dal = createDal();
    const created = dal.create({
      planId: "plan-1",
      stepIndex: 0,
      prompt: "Approve?",
    });

    const updated = dal.respond(created.id, false, "too risky");
    expect(updated).toBeDefined();
    expect(updated!.status).toBe("denied");
    expect(updated!.response_reason).toBe("too risky");
  });

  it("returns undefined when responding to already-responded approval", () => {
    const dal = createDal();
    const created = dal.create({
      planId: "plan-1",
      stepIndex: 0,
      prompt: "Approve?",
    });

    dal.respond(created.id, true);
    const second = dal.respond(created.id, false);
    expect(second).toBeUndefined();

    // Original response is preserved
    const fetched = dal.getById(created.id);
    expect(fetched!.status).toBe("approved");
  });

  it("lists pending approvals in creation order", () => {
    const dal = createDal();
    dal.create({ planId: "plan-1", stepIndex: 0, prompt: "First?" });
    dal.create({ planId: "plan-1", stepIndex: 1, prompt: "Second?" });
    const third = dal.create({ planId: "plan-2", stepIndex: 0, prompt: "Third?" });

    // Approve the third one so it leaves the pending list
    dal.respond(third.id, true);

    const pending = dal.getPending();
    expect(pending).toHaveLength(2);
    expect(pending[0]!.prompt).toBe("First?");
    expect(pending[1]!.prompt).toBe("Second?");
  });

  it("gets approvals by plan id", () => {
    const dal = createDal();
    dal.create({ planId: "plan-1", stepIndex: 0, prompt: "A?" });
    dal.create({ planId: "plan-1", stepIndex: 1, prompt: "B?" });
    dal.create({ planId: "plan-2", stepIndex: 0, prompt: "C?" });

    const forPlan1 = dal.getByPlanId("plan-1");
    expect(forPlan1).toHaveLength(2);
    expect(forPlan1[0]!.step_index).toBe(0);
    expect(forPlan1[1]!.step_index).toBe(1);

    const forPlan2 = dal.getByPlanId("plan-2");
    expect(forPlan2).toHaveLength(1);
  });

  it("expires stale approvals", () => {
    const dal = createDal();
    // Create an approval with an expires_at in the past
    const created = dal.create({
      planId: "plan-1",
      stepIndex: 0,
      prompt: "Approve?",
      expiresAt: "2020-01-01T00:00:00",
    });

    // Also create one that hasn't expired
    dal.create({
      planId: "plan-1",
      stepIndex: 1,
      prompt: "Also approve?",
      expiresAt: "2099-12-31T23:59:59",
    });

    // And one without expiry
    dal.create({
      planId: "plan-1",
      stepIndex: 2,
      prompt: "No expiry?",
    });

    const expired = dal.expireStale();
    expect(expired).toBe(1);

    const row = dal.getById(created.id);
    expect(row!.status).toBe("expired");
    expect(row!.responded_at).toBeTruthy();

    // The other two remain pending
    const pending = dal.getPending();
    expect(pending).toHaveLength(2);
  });

  it("creates approval with default empty context when none provided", () => {
    const dal = createDal();
    const approval = dal.create({
      planId: "plan-1",
      stepIndex: 0,
      prompt: "Approve?",
    });

    expect(approval.context).toEqual({});
  });
});
