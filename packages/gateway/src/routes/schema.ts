import { Hono } from "hono";
import { listSchemaNames, getJsonSchema, getAllJsonSchemas } from "@tyrum/schemas";

export function createSchemaRoutes(): Hono {
  const app = new Hono();

  /** GET /schemas — list all schema names */
  app.get("/schemas", async (c) => {
    const names = await listSchemaNames();
    return c.json({ schemas: names, count: names.length });
  });

  /** GET /schemas/all — dump every schema as JSON Schema */
  app.get("/schemas/all", async (c) => {
    const all = await getAllJsonSchemas();
    return c.json(all);
  });

  /** GET /schemas/:name — single schema as JSON Schema */
  app.get("/schemas/:name", async (c) => {
    const name = c.req.param("name");
    try {
      const schema = await getJsonSchema(name);
      return c.json(schema);
    } catch {
      return c.json({ error: "not_found", message: `Schema '${name}' not found` }, 404);
    }
  });

  return app;
}
