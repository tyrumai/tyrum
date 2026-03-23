import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { contractsCatalogPath, contractsDistEntrypointPath, repoRoot } from "./paths.mjs";
import { ensureBuildsFresh } from "../workspace-build-freshness.mjs";
import { createPackageBuilds } from "../workspace-package-builds.mjs";

const contractBuild = createPackageBuilds(repoRoot).find(
  (build) => build.name === "@tyrum/contracts",
);
if (!contractBuild) {
  throw new Error("Unable to resolve the @tyrum/contracts build definition.");
}

function ensureContractsArtifacts() {
  ensureBuildsFresh(repoRoot, [contractBuild]);
}

const MISSING_FILE_RETRY_LIMIT = 20;
const MISSING_FILE_RETRY_MS = 50;

function isMissingFileError(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function readUtf8WithRetry(path) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      // The contracts exporter rewrites dist/jsonschema atomically-by-directory and writes the
      // catalog last, so concurrent doc generation can briefly observe missing files.
      if (!isMissingFileError(error) || attempt >= MISSING_FILE_RETRY_LIMIT) {
        throw error;
      }
      await delay(MISSING_FILE_RETRY_MS);
    }
  }
}

export async function readContractsCatalog() {
  try {
    const raw = await readUtf8WithRetry(contractsCatalogPath);
    return JSON.parse(raw);
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  ensureContractsArtifacts();
  const raw = await readUtf8WithRetry(contractsCatalogPath);
  return JSON.parse(raw);
}

function cloneSchema(schema) {
  return structuredClone(schema);
}

function buildSchemaFromContractsExport(name, schemaId, contractsModule) {
  const value = contractsModule[name];
  if (!value || typeof value !== "object") return undefined;

  const toJSONSchema = value.toJSONSchema;
  if (typeof toJSONSchema !== "function") return undefined;

  const schema = toJSONSchema.call(value, { io: "input" });
  if (!schema || typeof schema !== "object") return undefined;

  const normalized = cloneSchema(schema);
  if (schemaId && !("$id" in normalized)) normalized.$id = schemaId;
  if (!("title" in normalized)) normalized.title = name;
  return normalized;
}

export function createContractSchemaResolver(input) {
  const {
    catalog,
    importContractsModule,
    readFileImpl = readUtf8WithRetry,
    rootDir = repoRoot,
  } = input;
  const schemaPathByName = new Map();
  for (const entry of catalog.schemas ?? []) {
    if (!entry?.name || !entry?.file) continue;
    schemaPathByName.set(entry.name, {
      path: join(rootDir, "packages/contracts/dist", entry.file),
      schemaId: entry.$id,
    });
  }
  const cache = new Map();
  let contractsModulePromise;

  async function loadContractsModule() {
    if (!contractsModulePromise) {
      contractsModulePromise = importContractsModule();
    }
    return await contractsModulePromise;
  }

  async function getSchema(name) {
    if (cache.has(name)) {
      return cloneSchema(cache.get(name));
    }

    const entry = schemaPathByName.get(name);
    if (!entry) return undefined;

    try {
      const raw = await readFileImpl(entry.path, "utf8");
      const parsed = JSON.parse(raw);
      cache.set(name, parsed);
      return cloneSchema(parsed);
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }

    const contractsModule = await loadContractsModule();
    const fallbackSchema = buildSchemaFromContractsExport(name, entry.schemaId, contractsModule);
    if (!fallbackSchema) return undefined;

    cache.set(name, fallbackSchema);
    return cloneSchema(fallbackSchema);
  }

  async function listSchemas() {
    const results = [];
    for (const name of schemaPathByName.keys()) {
      const schema = await getSchema(name);
      if (schema) {
        results.push({ name, schema });
      }
    }
    return results;
  }

  return { getSchema, listSchemas };
}

export async function buildContractSchemaResolver() {
  const catalog = await readContractsCatalog();
  return createContractSchemaResolver({
    catalog,
    importContractsModule: async () =>
      await import(pathToFileURL(contractsDistEntrypointPath).href),
  });
}

export function createPlaceholderSchema(name, description) {
  return {
    title: name,
    type: "object",
    description,
    additionalProperties: true,
  };
}

export async function resolveSchemaObject(resolver, name, fallbackDescription) {
  if (!name) return undefined;
  const schema = await resolver.getSchema(name);
  if (schema) return schema;
  return createPlaceholderSchema(
    name,
    fallbackDescription ?? `Schema "${name}" is declared outside @tyrum/contracts.`,
  );
}
