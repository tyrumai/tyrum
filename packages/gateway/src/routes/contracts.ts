import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function resolveSchemasJsonSchemaDir(): string {
  const entrypointUrl = import.meta.resolve("@tyrum/schemas");
  const entrypointPath = fileURLToPath(entrypointUrl);
  const pkgRoot = dirname(dirname(entrypointPath));
  return join(pkgRoot, "dist", "jsonschema");
}

function isSafeContractFilename(filename: string): boolean {
  if (!filename) return false;
  if (filename !== basename(filename)) return false;
  if (filename.includes("..")) return false;
  if (!filename.endsWith(".json")) return false;
  return true;
}

export function createContractRoutes(): Hono {
  const contracts = new Hono();
  const jsonSchemaDir = resolveSchemasJsonSchemaDir();
  const jsonSchemaDirResolved = resolve(jsonSchemaDir);

  contracts.get("/contracts/jsonschema/catalog.json", async (c) => {
    try {
      const raw = await readFile(join(jsonSchemaDir, "catalog.json"), "utf-8");
      return c.json(JSON.parse(raw));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json(
        {
          error: "contracts_unavailable",
          message: `Failed to read JSON Schema catalog: ${message}`,
        },
        500,
      );
    }
  });

  contracts.get("/contracts/jsonschema/:file", async (c) => {
    const file = c.req.param("file")?.trim() || "";
    if (!isSafeContractFilename(file) || file === "catalog.json") {
      return c.json(
        {
          error: "not_found",
          message: "Contract schema not found.",
        },
        404,
      );
    }

    const fullPath = resolve(jsonSchemaDirResolved, file);
    const rel = relative(jsonSchemaDirResolved, fullPath);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      return c.json(
        {
          error: "not_found",
          message: "Contract schema not found.",
        },
        404,
      );
    }

    try {
      const raw = await readFile(fullPath, "utf-8");
      return c.json(JSON.parse(raw));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("ENOENT")) {
        return c.json(
          {
            error: "not_found",
            message: "Contract schema not found.",
          },
          404,
        );
      }

      return c.json(
        {
          error: "contracts_unavailable",
          message: `Failed to read contract schema: ${message}`,
        },
        500,
      );
    }
  });

  return contracts;
}
