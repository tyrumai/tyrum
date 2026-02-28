import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TRANSIENT_READ_MAX_ATTEMPTS = 25;
const TRANSIENT_READ_DELAY_MS = 100;

function resolveSchemasJsonSchemaDir(): string {
  const entrypointUrl = import.meta.resolve("@tyrum/schemas");
  const entrypointPath = fileURLToPath(entrypointUrl);
  const pkgRoot = dirname(dirname(entrypointPath));
  return join(pkgRoot, "dist", "jsonschema");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function errorCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  if (!("code" in err)) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function isSafeContractFilename(filename: string): boolean {
  if (!filename) return false;
  if (filename !== basename(filename)) return false;
  if (filename.includes("..")) return false;
  if (!filename.endsWith(".json")) return false;
  return true;
}

async function readJsonFile(
  path: string,
  opts?: {
    transientNotFound?: boolean;
  },
): Promise<unknown> {
  let lastError: unknown = new Error(`Failed to read JSON file: ${path}`);

  for (let attempt = 0; attempt < TRANSIENT_READ_MAX_ATTEMPTS; attempt += 1) {
    try {
      const raw = await readFile(path, "utf-8");
      return JSON.parse(raw);
    } catch (err) {
      lastError = err;

      const code = errorCode(err);
      const isParseError = err instanceof SyntaxError;
      const isTransient = isParseError || (opts?.transientNotFound === true && code === "ENOENT");

      if (!isTransient || attempt === TRANSIENT_READ_MAX_ATTEMPTS - 1) {
        throw err;
      }

      await delay(TRANSIENT_READ_DELAY_MS);
    }
  }

  throw lastError;
}

export function createContractRoutes(): Hono {
  const contracts = new Hono();
  let jsonSchemaDir: string | undefined;
  let jsonSchemaDirResolved: string | undefined;
  try {
    jsonSchemaDir = resolveSchemasJsonSchemaDir();
    jsonSchemaDirResolved = resolve(jsonSchemaDir);
  } catch (err) {
    void err;
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
      const parsed: unknown = await readJsonFile(join(jsonSchemaDir, "catalog.json"), {
        transientNotFound: true,
      });

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
    } catch (err) {
      void err;
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
      const parsed = await readJsonFile(fullPath);
      return c.json(parsed);
    } catch (err) {
      const code = errorCode(err);

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
