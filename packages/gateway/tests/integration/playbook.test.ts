import { describe, expect, it, beforeEach } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import type { Playbook, ActionPrimitive } from "@tyrum/schemas";
import { loadAllPlaybooks } from "../../src/modules/playbook/loader.js";
import { PlaybookRunner } from "../../src/modules/playbook/runner.js";
import { createPlaybookRoutes } from "../../src/routes/playbook.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "../fixtures/playbooks");

describe("Playbook routes", () => {
  let playbooks: Playbook[];
  let runner: PlaybookRunner;
  let app: Hono;

  beforeEach(() => {
    playbooks = loadAllPlaybooks(fixturesDir, {
      onInvalidPlaybook: () => {},
    });
    runner = new PlaybookRunner();
    app = new Hono();
    app.route("/", createPlaybookRoutes({ playbooks, runner }));
  });

  describe("GET /playbooks", () => {
    it("lists all loaded playbooks", async () => {
      const res = await app.request("/playbooks", { method: "GET" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        playbooks: Array<{
          id: string;
          name: string;
          version: string;
          step_count: number;
        }>;
      };
      expect(body.playbooks.length).toBeGreaterThanOrEqual(2);

      const ids = body.playbooks.map((p) => p.id);
      expect(ids).toContain("test-playbook");
      expect(ids).toContain("second-playbook");

      const testPb = body.playbooks.find((p) => p.id === "test-playbook")!;
      expect(testPb.step_count).toBe(3);
      expect(testPb.version).toBe("1.0.0");
    });
  });

  describe("GET /playbooks/:id", () => {
    it("returns a single playbook", async () => {
      const res = await app.request("/playbooks/test-playbook", { method: "GET" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Playbook;
      expect(body.manifest.id).toBe("test-playbook");
      expect(body.manifest.steps).toHaveLength(3);
      expect(body.manifest.allowed_domains).toEqual(["example.com"]);
    });

    it("returns 404 for unknown playbook", async () => {
      const res = await app.request("/playbooks/nonexistent", { method: "GET" });
      expect(res.status).toBe(404);
    });
  });

  describe("POST /playbooks/:id/run", () => {
    it("converts playbook steps to action primitives", async () => {
      const res = await app.request("/playbooks/test-playbook/run", {
        method: "POST",
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        playbook_id: string;
        steps: ActionPrimitive[];
        created_at: string;
      };
      expect(body.playbook_id).toBe("test-playbook");
      expect(body.steps).toHaveLength(3);
      expect(body.steps[0]!.type).toBe("Web");
      expect(body.steps[1]!.type).toBe("Web");
      expect(body.steps[2]!.type).toBe("Web");
      expect(body.created_at).toBeDefined();
    });

    it("returns 404 for unknown playbook", async () => {
      const res = await app.request("/playbooks/nonexistent/run", {
        method: "POST",
      });
      expect(res.status).toBe(404);
    });

    it("tracks run stats across invocations", async () => {
      await app.request("/playbooks/test-playbook/run", { method: "POST" });
      await app.request("/playbooks/test-playbook/run", { method: "POST" });

      const stats = runner.getStats();
      const entry = stats.find((s) => s.playbook_id === "test-playbook");
      expect(entry).toBeDefined();
      expect(entry!.run_count).toBe(2);
    });
  });
});
