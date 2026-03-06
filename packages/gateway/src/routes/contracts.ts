import { Hono, type Context } from "hono";
import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TRANSIENT_READ_MAX_ATTEMPTS = 50;
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

function resolveSchemaDirState(): {
  jsonSchemaDir: string | undefined;
  jsonSchemaDirResolved: string | undefined;
} {
  try {
    const jsonSchemaDir = resolveSchemasJsonSchemaDir();
    return {
      jsonSchemaDir,
      jsonSchemaDirResolved: resolve(jsonSchemaDir),
    };
  } catch (err) {
    void err;
    return {
      jsonSchemaDir: undefined,
      jsonSchemaDirResolved: undefined,
    };
  }
}

let cachedSchemaDirState:
  | {
      jsonSchemaDir: string | undefined;
      jsonSchemaDirResolved: string | undefined;
    }
  | undefined;

function getSchemaDirState(): {
  jsonSchemaDir: string | undefined;
  jsonSchemaDirResolved: string | undefined;
} {
  if (cachedSchemaDirState?.jsonSchemaDir && cachedSchemaDirState.jsonSchemaDirResolved) {
    return cachedSchemaDirState;
  }

  const resolved = resolveSchemaDirState();
  if (resolved.jsonSchemaDir && resolved.jsonSchemaDirResolved) {
    cachedSchemaDirState = resolved;
  }
  return resolved;
}

function unavailableResponse(c: Context, message: string): Response {
  return c.json(
    {
      error: "contracts_unavailable",
      message,
    },
    500,
  );
}

function notFoundResponse(c: Context): Response {
  return c.json(
    {
      error: "not_found",
      message: "Contract schema not found.",
    },
    404,
  );
}

function sanitizeCatalogEntry(entry: unknown): unknown {
  if (!entry || typeof entry !== "object") return entry;
  const file =
    "file" in entry && typeof (entry as { file?: unknown }).file === "string"
      ? basename(String((entry as { file: string }).file))
      : undefined;
  if (!file) return entry;
  return Object.assign({}, entry, { file });
}

function sanitizeCatalogPayload(parsed: unknown): unknown {
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("schemas" in parsed) ||
    !Array.isArray((parsed as { schemas?: unknown }).schemas)
  ) {
    return parsed;
  }

  const schemas = (parsed as { schemas: unknown[] }).schemas.map(sanitizeCatalogEntry);
  return { ...(parsed as Record<string, unknown>), schemas };
}

async function handleCatalogRequest(
  c: Context,
  jsonSchemaDir: string | undefined,
): Promise<Response> {
  if (!jsonSchemaDir) {
    return unavailableResponse(c, "JSON Schema catalog unavailable.");
  }

  try {
    const parsed: unknown = await readJsonFile(join(jsonSchemaDir, "catalog.json"), {
      transientNotFound: true,
    });
    return c.json(sanitizeCatalogPayload(parsed));
  } catch (err) {
    void err;
    return unavailableResponse(c, "JSON Schema catalog unavailable.");
  }
}

async function handleSchemaRequest(
  c: Context,
  jsonSchemaDirResolved: string | undefined,
): Promise<Response> {
  if (!jsonSchemaDirResolved) {
    return unavailableResponse(c, "Contract schema unavailable.");
  }

  const file = c.req.param("file")?.trim() || "";
  if (!isSafeContractFilename(file) || file === "catalog.json") {
    return notFoundResponse(c);
  }

  const fullPath = resolve(jsonSchemaDirResolved, file);
  const rel = relative(jsonSchemaDirResolved, fullPath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return notFoundResponse(c);
  }

  try {
    const parsed = await readJsonFile(fullPath);
    return c.json(parsed);
  } catch (err) {
    if (errorCode(err) === "ENOENT") {
      return notFoundResponse(c);
    }

    return unavailableResponse(c, "Contract schema unavailable.");
  }
}

export function createContractRoutes(): Hono {
  const contracts = new Hono();

  contracts.get("/contracts/jsonschema/catalog.json", (c) => {
    const { jsonSchemaDir } = getSchemaDirState();
    return handleCatalogRequest(c, jsonSchemaDir);
  });
  contracts.get("/contracts/jsonschema/:file", (c) => {
    const { jsonSchemaDirResolved } = getSchemaDirState();
    return handleSchemaRequest(c, jsonSchemaDirResolved);
  });

  return contracts;
}
