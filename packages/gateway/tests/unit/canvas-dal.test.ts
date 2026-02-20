import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CanvasDal } from "../../src/modules/canvas/dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("CanvasDal", () => {
  let db: SqliteDb;
  let dal: CanvasDal;

  beforeEach(() => {
    db = openTestSqliteDb();
    dal = new CanvasDal(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it("publishes and retrieves an artifact", async () => {
    const artifact = await dal.publish({
      title: "Test Chart",
      contentType: "text/html",
      htmlContent: "<h1>Hello</h1>",
    });

    expect(artifact.id).toBeTruthy();
    expect(artifact.title).toBe("Test Chart");
    expect(artifact.content_type).toBe("text/html");
    expect(artifact.html_content).toBe("<h1>Hello</h1>");
    expect(artifact.created_at).toBeTruthy();

    const retrieved = await dal.getById(artifact.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.title).toBe("Test Chart");
  });

  it("stores plan_id and metadata", async () => {
    const artifact = await dal.publish({
      planId: "plan-123",
      title: "Report",
      contentType: "text/html",
      htmlContent: "<p>Report body</p>",
      metadata: { source: "agent", version: 2 },
    });

    expect(artifact.plan_id).toBe("plan-123");
    const meta = artifact.metadata as Record<string, unknown>;
    expect(meta.source).toBe("agent");
    expect(meta.version).toBe(2);
  });

  it("returns undefined for unknown id", async () => {
    const result = await dal.getById("nonexistent-uuid");
    expect(result).toBeUndefined();
  });

  it("lists artifacts by plan", async () => {
    await dal.publish({
      planId: "plan-A",
      title: "First",
      contentType: "text/html",
      htmlContent: "<p>1</p>",
    });
    await dal.publish({
      planId: "plan-A",
      title: "Second",
      contentType: "text/plain",
      htmlContent: "plain text",
    });
    await dal.publish({
      planId: "plan-B",
      title: "Other",
      contentType: "text/html",
      htmlContent: "<p>other</p>",
    });

    const planA = await dal.listByPlan("plan-A");
    expect(planA).toHaveLength(2);
    expect(planA[0].title).toBe("First");
    expect(planA[1].title).toBe("Second");

    const planB = await dal.listByPlan("plan-B");
    expect(planB).toHaveLength(1);
  });

  it("returns empty array for unknown plan", async () => {
    const result = await dal.listByPlan("nonexistent-plan");
    expect(result).toEqual([]);
  });

  it("rejects invalid content_type", async () => {
    await expect(
      dal.publish({
        title: "Bad",
        contentType: "application/json",
        htmlContent: "{}",
      }),
    ).rejects.toThrow(/Invalid content_type/);
  });

  it("supports text/plain content type", async () => {
    const artifact = await dal.publish({
      title: "Plain",
      contentType: "text/plain",
      htmlContent: "Just plain text",
    });

    expect(artifact.content_type).toBe("text/plain");
  });

  it("defaults metadata to empty object", async () => {
    const artifact = await dal.publish({
      title: "No Meta",
      contentType: "text/html",
      htmlContent: "<p>hi</p>",
    });

    expect(artifact.metadata).toEqual({});
  });

  it("defaults plan_id to null", async () => {
    const artifact = await dal.publish({
      title: "No Plan",
      contentType: "text/html",
      htmlContent: "<p>hi</p>",
    });

    expect(artifact.plan_id).toBeNull();
  });
});
