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
  let jsonSchemaDir: string | undefined;
  let jsonSchemaDirResolved: string | undefined;
  try {
    jsonSchemaDir = resolveSchemasJsonSchemaDir();
    jsonSchemaDirResolved = resolve(jsonSchemaDir);
  } catch {
    jsonSchemaDir = undefined;
    jsonSchemaDirResolved = undefined;
  }

  contracts.get("/contracts/jsonschema/catalog.json", async (c) => {
    if (!jsonSchemaDir) {
      return c.json(
        {
          error: "contracts_unavailable",
          message: "JSON Schema catalog unavailable.",
        },
        500,
      );
    }

    try {
      const raw = await readFile(join(jsonSchemaDir, "catalog.json"), "utf-8");
      const parsed: unknown = JSON.parse(raw);

      if (
        parsed &&
        typeof parsed === "object" &&
        "schemas" in parsed &&
        Array.isArray((parsed as { schemas?: unknown }).schemas)
      ) {
        const schemas = (parsed as { schemas: unknown[] }).schemas.map((entry) => {
          if (!entry || typeof entry !== "object") return entry;
          const file =
            "file" in entry && typeof (entry as { file?: unknown }).file === "string"
              ? basename(String((entry as { file: string }).file))
              : undefined;
          if (!file) return entry;
          return { ...entry, file };
        });

        return c.json({ ...(parsed as Record<string, unknown>), schemas });
      }

      return c.json(parsed);
    } catch {
      return c.json(
        {
          error: "contracts_unavailable",
          message: "JSON Schema catalog unavailable.",
        },
        500,
      );
    }
  });

  contracts.get("/contracts/jsonschema/:file", async (c) => {
    if (!jsonSchemaDirResolved) {
      return c.json(
        {
          error: "contracts_unavailable",
          message: "Contract schema unavailable.",
        },
        500,
      );
    }

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
      const code =
        err && typeof err === "object" && "code" in err &&
        typeof (err as { code?: unknown }).code === "string"
          ? String((err as { code: string }).code)
          : undefined;

      if (code === "ENOENT") {
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
          message: "Contract schema unavailable.",
        },
        500,
      );
    }
  });

  return contracts;
}
