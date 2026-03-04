import { describe, expect, it, beforeEach } from "vitest";
import type { Hono } from "hono";
import { createTestApp } from "./helpers.js";

describe("Canvas routes", () => {
  let app: Hono;

  beforeEach(async () => {
    const result = await createTestApp();
    app = result.app;
  });

  describe("POST /canvas/publish", () => {
    it("publishes an HTML artifact", async () => {
      const res = await app.request("/canvas/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Dashboard",
          content_type: "text/html",
          content: "<h1>Dashboard</h1><p>Stats here</p>",
          metadata: { theme: "dark" },
          links: [{ parent_kind: "plan", parent_id: "plan-42" }],
        }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { canvas_artifact_id: string; created_at: string };
      expect(body.canvas_artifact_id).toBeTruthy();
      expect(body.created_at).toBeTruthy();
    });

    it("returns 400 for missing required fields", async () => {
      const res = await app.request("/canvas/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Incomplete" }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("invalid_request");
    });

    it("returns 400 for invalid content_type", async () => {
      const res = await app.request("/canvas/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Bad Type",
          content_type: "application/json",
          content: "{}",
        }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("invalid_request");
    });
  });

  describe("GET /canvas/:id", () => {
    it("serves HTML with CSP headers", async () => {
      const publishRes = await app.request("/canvas/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Secure Page",
          content_type: "text/html",
          content: "<h1>Sandboxed</h1>",
        }),
      });

      const { canvas_artifact_id: id } = (await publishRes.json()) as {
        canvas_artifact_id: string;
      };

      const getRes = await app.request(`/canvas/${id}`);
      expect(getRes.status).toBe(200);

      const csp = getRes.headers.get("Content-Security-Policy");
      expect(csp).toBe(
        "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'",
      );

      const contentType = getRes.headers.get("Content-Type");
      expect(contentType).toContain("text/html");

      const body = await getRes.text();
      expect(body).toBe("<h1>Sandboxed</h1>");
    });

    it("serves text/plain with CSP headers", async () => {
      const publishRes = await app.request("/canvas/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Plain Doc",
          content_type: "text/plain",
          content: "Just text",
        }),
      });

      const { canvas_artifact_id: id } = (await publishRes.json()) as {
        canvas_artifact_id: string;
      };

      const getRes = await app.request(`/canvas/${id}`);
      expect(getRes.status).toBe(200);

      const contentType = getRes.headers.get("Content-Type");
      expect(contentType).toContain("text/plain");

      const csp = getRes.headers.get("Content-Security-Policy");
      expect(csp).toBe(
        "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'",
      );
    });

    it("returns 404 for unknown artifact", async () => {
      const res = await app.request("/canvas/nonexistent-uuid");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /canvas/:id/meta", () => {
    it("returns metadata without content", async () => {
      const publishRes = await app.request("/canvas/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Meta Test",
          content_type: "text/html",
          content: "<p>Body</p>",
          metadata: { author: "agent" },
          links: [{ parent_kind: "plan", parent_id: "plan-99" }],
        }),
      });

      const { canvas_artifact_id: id } = (await publishRes.json()) as {
        canvas_artifact_id: string;
      };

      const metaRes = await app.request(`/canvas/${id}/meta`);
      expect(metaRes.status).toBe(200);

      const body = (await metaRes.json()) as {
        canvas_artifact_id: string;
        workspace_id: string;
        title: string;
        content_type: string;
        metadata: Record<string, unknown>;
        created_at: string;
      };

      expect(body.canvas_artifact_id).toBe(id);
      expect(body.title).toBe("Meta Test");
      expect(body.content_type).toBe("text/html");
      expect(body.metadata.author).toBe("agent");
      // Should NOT include html_content
      expect("content" in body).toBe(false);
    });

    it("returns 404 for unknown artifact", async () => {
      const res = await app.request("/canvas/nonexistent-uuid/meta");
      expect(res.status).toBe(404);
    });
  });
});
