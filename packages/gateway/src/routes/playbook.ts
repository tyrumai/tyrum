/**
 * Playbook routes — list, detail, and run loaded playbooks.
 */

import { Hono } from "hono";
import type { Playbook } from "@tyrum/schemas";
import { PlaybookRunner } from "../modules/playbook/runner.js";

export interface PlaybookRouteDeps {
  playbooks: Playbook[];
  runner: PlaybookRunner;
}

export function createPlaybookRoutes(deps: PlaybookRouteDeps): Hono {
  const app = new Hono();

  app.get("/playbooks", (c) => {
    const items = deps.playbooks.map((pb) => ({
      id: pb.manifest.id,
      name: pb.manifest.name,
      description: pb.manifest.description ?? null,
      version: pb.manifest.version,
      step_count: pb.manifest.steps.length,
      file_path: pb.file_path,
      loaded_at: pb.loaded_at,
    }));
    return c.json({ playbooks: items });
  });

  app.get("/playbooks/:id", (c) => {
    const id = c.req.param("id");
    const pb = deps.playbooks.find((p) => p.manifest.id === id);
    if (!pb) {
      return c.json({ error: "not_found", message: `Playbook '${id}' not found` }, 404);
    }
    return c.json(pb);
  });

  app.post("/playbooks/:id/run", (c) => {
    const id = c.req.param("id");
    const pb = deps.playbooks.find((p) => p.manifest.id === id);
    if (!pb) {
      return c.json({ error: "not_found", message: `Playbook '${id}' not found` }, 404);
    }

    const result = deps.runner.run(pb);
    return c.json(result);
  });

  return app;
}
