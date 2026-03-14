import { Hono, type Context } from "hono";
import { readFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ZodTypeAny } from "zod";

const TRANSIENT_READ_MAX_ATTEMPTS = 50;
const TRANSIENT_READ_DELAY_MS = 100;

function resolveSchemasJsonSchemaDir(): string {
  return fileURLToPath(new URL("../../../schemas/dist/jsonschema", import.meta.url));
}

function resolveSchemasPackageJsonPath(): string {
  return fileURLToPath(new URL("../../../schemas/package.json", import.meta.url));
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

async function readJsonFile(path: string): Promise<unknown> {
  let lastError: unknown = new Error(`Failed to read JSON file: ${path}`);

  for (let attempt = 0; attempt < TRANSIENT_READ_MAX_ATTEMPTS; attempt += 1) {
    try {
      const raw = await readFile(path, "utf-8");
      return JSON.parse(raw);
    } catch (err) {
      lastError = err;

      if (!(err instanceof SyntaxError) || attempt === TRANSIENT_READ_MAX_ATTEMPTS - 1) {
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

interface GeneratedContractCatalogSchemaEntry {
  name: string;
  file: string;
  $id: string;
}

interface GeneratedContractCatalog {
  format: "tyrum.contracts.jsonschema.catalog.v1";
  generated_at: string;
  package: {
    name: "@tyrum/schemas";
    version: string;
  };
  schemas: GeneratedContractCatalogSchemaEntry[];
  errors?: Array<{ name: string; error: string }>;
}

interface GeneratedContractState {
  catalog: GeneratedContractCatalog;
  schemasByFile: Map<string, unknown>;
}

let generatedContractStatePromise: Promise<GeneratedContractState> | undefined;

async function getGeneratedContractState(): Promise<GeneratedContractState> {
  if (!generatedContractStatePromise) {
    generatedContractStatePromise = buildGeneratedContractState().catch((err) => {
      generatedContractStatePromise = undefined;
      throw err;
    });
  }

  return await generatedContractStatePromise;
}

function hasToJsonSchema(value: unknown): value is ZodTypeAny & {
  toJSONSchema: (opts?: { io?: "input" | "output" }) => Record<string, unknown> | undefined;
} {
  if (!value || typeof value !== "object") return false;
  return typeof (value as { toJSONSchema?: unknown }).toJSONSchema === "function";
}

async function buildGeneratedContractState(): Promise<GeneratedContractState> {
  const [schemasModule, schemasPackageRaw] = await Promise.all([
    import("@tyrum/schemas"),
    readFile(resolveSchemasPackageJsonPath(), "utf-8").catch(() => undefined),
  ]);

  const generatedAt = new Date().toISOString();
  const schemasByFile = new Map<string, unknown>();
  const catalogSchemas: GeneratedContractCatalogSchemaEntry[] = [];
  const errors: Array<{ name: string; error: string }> = [];
  const packageVersion = (() => {
    if (!schemasPackageRaw) return "0.0.0-dev";
    try {
      const parsed = JSON.parse(schemasPackageRaw) as { version?: unknown };
      return typeof parsed.version === "string" ? parsed.version : "0.0.0-dev";
    } catch (err) {
      void err;
      return "0.0.0-dev";
    }
  })();

  for (const [name, value] of Object.entries(schemasModule)) {
    if (!hasToJsonSchema(value)) continue;

    try {
      const schema = value.toJSONSchema({ io: "input" });
      if (!schema || typeof schema !== "object") continue;

      const file = `${name}.json`;
      const id = `https://schemas.tyrum.dev/${packageVersion}/${encodeURIComponent(name)}.json`;
      if (!("$id" in schema)) {
        schema.$id = id;
      }
      if (!("title" in schema)) {
        schema.title = name;
      }

      schemasByFile.set(file, schema);
      catalogSchemas.push({ name, file, $id: id });
    } catch (err) {
      errors.push({
        name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  catalogSchemas.sort((left, right) => left.name.localeCompare(right.name));

  return {
    catalog: {
      format: "tyrum.contracts.jsonschema.catalog.v1",
      generated_at: generatedAt,
      package: {
        name: "@tyrum/schemas",
        version: packageVersion,
      },
      schemas: catalogSchemas,
      errors: errors.length > 0 ? errors : undefined,
    },
    schemasByFile,
  };
}

async function handleCatalogRequest(
  c: Context,
  jsonSchemaDir: string | undefined,
): Promise<Response> {
  if (!jsonSchemaDir) {
    try {
      return c.json((await getGeneratedContractState()).catalog);
    } catch (err) {
      void err;
      return unavailableResponse(c, "JSON Schema catalog unavailable.");
    }
  }

  try {
    const parsed: unknown = await readJsonFile(join(jsonSchemaDir, "catalog.json"));
    return c.json(sanitizeCatalogPayload(parsed));
  } catch (err) {
    try {
      return c.json((await getGeneratedContractState()).catalog);
    } catch (fallbackErr) {
      void err;
      void fallbackErr;
      return unavailableResponse(c, "JSON Schema catalog unavailable.");
    }
  }
}

async function handleSchemaRequest(
  c: Context,
  jsonSchemaDirResolved: string | undefined,
): Promise<Response> {
  if (!jsonSchemaDirResolved) {
    try {
      const generatedSchema = (await getGeneratedContractState()).schemasByFile.get(
        c.req.param("file")?.trim() || "",
      );
      if (!generatedSchema) return notFoundResponse(c);
      return c.json(generatedSchema);
    } catch (err) {
      void err;
      return unavailableResponse(c, "Contract schema unavailable.");
    }
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
      try {
        const generatedSchema = (await getGeneratedContractState()).schemasByFile.get(file);
        if (!generatedSchema) return notFoundResponse(c);
        return c.json(generatedSchema);
      } catch (fallbackErr) {
        void fallbackErr;
        return notFoundResponse(c);
      }
    }

    try {
      const generatedSchema = (await getGeneratedContractState()).schemasByFile.get(file);
      if (!generatedSchema) return notFoundResponse(c);
      return c.json(generatedSchema);
    } catch (fallbackErr) {
      void fallbackErr;
      return unavailableResponse(c, "Contract schema unavailable.");
    }
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
