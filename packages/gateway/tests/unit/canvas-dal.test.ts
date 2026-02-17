import { describe, expect, it, beforeEach } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../../src/db.js";
import { migrate } from "../../src/migrate.js";
import { CanvasDal } from "../../src/modules/canvas/dal.js";
import type Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations");

describe("CanvasDal", () => {
  let db: Database.Database;
  let dal: CanvasDal;

  beforeEach(() => {
    db = createDatabase(":memory:");
    migrate(db, migrationsDir);
    dal = new CanvasDal(db);
  });

  it("publishes and retrieves an artifact", () => {
    const artifact = dal.publish({
      title: "Test Chart",
      contentType: "text/html",
      htmlContent: "<h1>Hello</h1>",
    });

    expect(artifact.id).toBeTruthy();
    expect(artifact.title).toBe("Test Chart");
    expect(artifact.content_type).toBe("text/html");
    expect(artifact.html_content).toBe("<h1>Hello</h1>");
    expect(artifact.created_at).toBeTruthy();

    const retrieved = dal.getById(artifact.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.title).toBe("Test Chart");
  });

  it("stores plan_id and metadata", () => {
    const artifact = dal.publish({
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

  it("returns undefined for unknown id", () => {
    const result = dal.getById("nonexistent-uuid");
    expect(result).toBeUndefined();
  });

  it("lists artifacts by plan", () => {
    dal.publish({
      planId: "plan-A",
      title: "First",
      contentType: "text/html",
      htmlContent: "<p>1</p>",
    });
    dal.publish({
      planId: "plan-A",
      title: "Second",
      contentType: "text/plain",
      htmlContent: "plain text",
    });
    dal.publish({
      planId: "plan-B",
      title: "Other",
      contentType: "text/html",
      htmlContent: "<p>other</p>",
    });

    const planA = dal.listByPlan("plan-A");
    expect(planA).toHaveLength(2);
    expect(planA[0].title).toBe("First");
    expect(planA[1].title).toBe("Second");

    const planB = dal.listByPlan("plan-B");
    expect(planB).toHaveLength(1);
  });

  it("returns empty array for unknown plan", () => {
    const result = dal.listByPlan("nonexistent-plan");
    expect(result).toEqual([]);
  });

  it("rejects invalid content_type", () => {
    expect(() =>
      dal.publish({
        title: "Bad",
        contentType: "application/json",
        htmlContent: "{}",
      }),
    ).toThrow("Invalid content_type");
  });

  it("supports text/plain content type", () => {
    const artifact = dal.publish({
      title: "Plain",
      contentType: "text/plain",
      htmlContent: "Just plain text",
    });

    expect(artifact.content_type).toBe("text/plain");
  });

  it("defaults metadata to empty object", () => {
    const artifact = dal.publish({
      title: "No Meta",
      contentType: "text/html",
      htmlContent: "<p>hi</p>",
    });

    expect(artifact.metadata).toEqual({});
  });

  it("defaults plan_id to null", () => {
    const artifact = dal.publish({
      title: "No Plan",
      contentType: "text/html",
      htmlContent: "<p>hi</p>",
    });

    expect(artifact.plan_id).toBeNull();
  });
});
