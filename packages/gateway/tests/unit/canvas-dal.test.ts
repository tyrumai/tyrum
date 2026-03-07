import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CanvasDal } from "../../src/modules/canvas/dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID } from "../../src/modules/identity/scope.js";

describe("CanvasDal", () => {
  let db: SqliteDb;
  let didOpenDb = false;
  let dal: CanvasDal;

  beforeEach(() => {
    didOpenDb = false;
    db = openTestSqliteDb();
    didOpenDb = true;
    dal = new CanvasDal(db);
  });

  afterEach(async () => {
    if (!didOpenDb) return;
    didOpenDb = false;
    await db.close();
  });

  it("publishes and retrieves an artifact", async () => {
    const artifact = await dal.publish({
      tenantId: DEFAULT_TENANT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      title: "Test Chart",
      contentType: "text/html",
      content: "<h1>Hello</h1>",
    });

    expect(artifact.canvas_artifact_id).toBeTruthy();
    expect(artifact.title).toBe("Test Chart");
    expect(artifact.content_type).toBe("text/html");
    expect(artifact.content).toBe("<h1>Hello</h1>");
    expect(artifact.created_at).toBeTruthy();

    const retrieved = await dal.getById({
      tenantId: DEFAULT_TENANT_ID,
      canvasArtifactId: artifact.canvas_artifact_id,
    });
    expect(retrieved).toBeDefined();
    expect(retrieved!.title).toBe("Test Chart");
  });

  it("stores links and metadata", async () => {
    const artifact = await dal.publish({
      tenantId: DEFAULT_TENANT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      title: "Report",
      contentType: "text/html",
      content: "<p>Report body</p>",
      metadata: { source: "agent", version: 2 },
      links: [{ parentKind: "plan", parentId: "plan-123" }],
    });

    const meta = artifact.metadata as Record<string, unknown>;
    expect(meta.source).toBe("agent");
    expect(meta.version).toBe(2);

    const linked = await dal.listByParent({
      tenantId: DEFAULT_TENANT_ID,
      parentKind: "plan",
      parentId: "plan-123",
    });
    expect(linked.map((row) => row.canvas_artifact_id)).toContain(artifact.canvas_artifact_id);
  });

  it("returns undefined for unknown id", async () => {
    const result = await dal.getById({
      tenantId: DEFAULT_TENANT_ID,
      canvasArtifactId: "nonexistent-uuid",
    });
    expect(result).toBeUndefined();
  });

  it("lists artifacts by parent", async () => {
    await dal.publish({
      tenantId: DEFAULT_TENANT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      title: "First",
      contentType: "text/html",
      content: "<p>1</p>",
      links: [{ parentKind: "plan", parentId: "plan-A" }],
    });
    await dal.publish({
      tenantId: DEFAULT_TENANT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      title: "Second",
      contentType: "text/plain",
      content: "plain text",
      links: [{ parentKind: "plan", parentId: "plan-A" }],
    });
    await dal.publish({
      tenantId: DEFAULT_TENANT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      title: "Other",
      contentType: "text/html",
      content: "<p>other</p>",
      links: [{ parentKind: "plan", parentId: "plan-B" }],
    });

    const planA = await dal.listByParent({
      tenantId: DEFAULT_TENANT_ID,
      parentKind: "plan",
      parentId: "plan-A",
    });
    expect(planA).toHaveLength(2);
    expect(planA.map((row) => row.title).toSorted()).toEqual(["First", "Second"]);

    const planB = await dal.listByParent({
      tenantId: DEFAULT_TENANT_ID,
      parentKind: "plan",
      parentId: "plan-B",
    });
    expect(planB).toHaveLength(1);
  });

  it("returns empty array for unknown plan", async () => {
    const result = await dal.listByParent({
      tenantId: DEFAULT_TENANT_ID,
      parentKind: "plan",
      parentId: "nonexistent-plan",
    });
    expect(result).toEqual([]);
  });

  it("rejects invalid content_type", async () => {
    await expect(
      dal.publish({
        tenantId: DEFAULT_TENANT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        title: "Bad",
        contentType: "application/json",
        content: "{}",
      }),
    ).rejects.toThrow(/Invalid content_type/);
  });

  it("supports text/plain content type", async () => {
    const artifact = await dal.publish({
      tenantId: DEFAULT_TENANT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      title: "Plain",
      contentType: "text/plain",
      content: "Just plain text",
    });

    expect(artifact.content_type).toBe("text/plain");
  });

  it("defaults metadata to empty object", async () => {
    const artifact = await dal.publish({
      tenantId: DEFAULT_TENANT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      title: "No Meta",
      contentType: "text/html",
      content: "<p>hi</p>",
    });

    expect(artifact.metadata).toEqual({});
  });
});
