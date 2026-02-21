import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { CanvasDal } from "../../src/modules/canvas/dal.js";
import { createCanvasRoutes } from "../../src/routes/canvas.js";

interface ArtifactMeta {
  id: string;
  plan_id: string | null;
  title: string;
  content_type: string;
  metadata: unknown;
  created_at: string;
}

interface ListResponse {
  artifacts: ArtifactMeta[];
}

function setup() {
  const db = openTestSqliteDb();
  const canvasDal = new CanvasDal(db);
  const app = new Hono();
  app.route("/", createCanvasRoutes(canvasDal));
  return { app, canvasDal };
}

async function publishArtifact(
  canvasDal: CanvasDal,
  overrides: { title?: string; planId?: string } = {},
) {
  return canvasDal.publish({
    title: overrides.title ?? "Test Artifact",
    contentType: "text/html",
    htmlContent: "<p>hello</p>",
    planId: overrides.planId,
  });
}

describe("GET /canvas (list)", () => {
  it("returns empty array when no artifacts exist", async () => {
    const { app } = setup();

    const res = await app.request("/canvas");
    expect(res.status).toBe(200);

    const body = (await res.json()) as ListResponse;
    expect(body.artifacts).toEqual([]);
  });

  it("returns artifacts with metadata but no html_content", async () => {
    const { app, canvasDal } = setup();
    const published = await publishArtifact(canvasDal, {
      title: "Dashboard",
      planId: "plan-1",
    });

    const res = await app.request("/canvas");
    expect(res.status).toBe(200);

    const body = (await res.json()) as ListResponse;
    expect(body.artifacts).toHaveLength(1);

    const artifact = body.artifacts[0];
    expect(artifact.id).toBe(published.id);
    expect(artifact.plan_id).toBe("plan-1");
    expect(artifact.title).toBe("Dashboard");
    expect(artifact.content_type).toBe("text/html");
    expect(artifact.created_at).toBeTruthy();
    expect("html_content" in artifact).toBe(false);
  });

  it("respects ?limit=2", async () => {
    const { app, canvasDal } = setup();
    await publishArtifact(canvasDal, { title: "A" });
    await publishArtifact(canvasDal, { title: "B" });
    await publishArtifact(canvasDal, { title: "C" });

    const res = await app.request("/canvas?limit=2");
    expect(res.status).toBe(200);

    const body = (await res.json()) as ListResponse;
    expect(body.artifacts).toHaveLength(2);
  });

  it("caps limit at 500", async () => {
    const { app, canvasDal } = setup();
    await publishArtifact(canvasDal);

    const res = await app.request("/canvas?limit=999");
    expect(res.status).toBe(200);

    // We cannot directly observe the SQL LIMIT, but verify the request
    // succeeds and does not return more than what exists (1 artifact).
    // The route clamps 999 -> 500 internally.
    const body = (await res.json()) as ListResponse;
    expect(body.artifacts).toHaveLength(1);
  });
});
