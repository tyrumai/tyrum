import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

function resolveSpecPath(filename: "openapi.json" | "asyncapi.json"): string {
  return fileURLToPath(new URL(`../../../../specs/${filename}`, import.meta.url));
}

async function readSpec(filename: "openapi.json" | "asyncapi.json"): Promise<unknown> {
  const raw = await readFile(resolveSpecPath(filename), "utf8");
  return JSON.parse(raw);
}

export function createSpecRoutes(): Hono {
  const app = new Hono();

  app.get("/specs/openapi.json", async (c) => {
    try {
      return c.json(await readSpec("openapi.json"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      return c.json({ error: "spec_unavailable", message }, 500);
    }
  });

  app.get("/specs/asyncapi.json", async (c) => {
    try {
      return c.json(await readSpec("asyncapi.json"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      return c.json({ error: "spec_unavailable", message }, 500);
    }
  });

  return app;
}
