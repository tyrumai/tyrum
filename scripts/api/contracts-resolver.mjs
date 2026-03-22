import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { contractsCatalogPath, repoRoot } from "./paths.mjs";

export async function readContractsCatalog() {
  const raw = await readFile(contractsCatalogPath, "utf8");
  return JSON.parse(raw);
}

export async function buildContractSchemaResolver() {
  const catalog = await readContractsCatalog();
  const schemaPathByName = new Map();
  const schemaEntryByName = new Map();
  for (const entry of catalog.schemas ?? []) {
    if (!entry?.name || !entry?.file) continue;
    schemaEntryByName.set(entry.name, entry);
    schemaPathByName.set(entry.name, join(repoRoot, "packages/contracts/dist", entry.file));
  }
  const cache = new Map();
  const contractsDistPath = join(repoRoot, "packages/contracts/dist/index.mjs");
  let contractsDistPromise;

  async function loadContractsDist() {
    if (!contractsDistPromise) {
      contractsDistPromise = import(pathToFileURL(contractsDistPath).href);
    }
    return contractsDistPromise;
  }

  async function readSchemaFromContractsDist(name) {
    const contractsDist = await loadContractsDist();
    const schemaExport = contractsDist[name];
    if (!schemaExport || typeof schemaExport !== "object") {
      return undefined;
    }
    const toJSONSchema = schemaExport.toJSONSchema;
    if (typeof toJSONSchema !== "function") {
      return undefined;
    }
    const schema = toJSONSchema.call(schemaExport, { io: "input" });
    if (!schema || typeof schema !== "object") {
      return undefined;
    }
    const entry = schemaEntryByName.get(name);
    if (entry?.$id && !("$id" in schema)) schema.$id = entry.$id;
    if (!("title" in schema)) schema.title = name;
    return schema;
  }

  async function getSchema(name) {
    if (cache.has(name)) {
      return structuredClone(cache.get(name));
    }
    const path = schemaPathByName.get(name);
    if (!path) return undefined;
    try {
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw);
      cache.set(name, parsed);
      return structuredClone(parsed);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }

    const fallback = await readSchemaFromContractsDist(name);
    if (!fallback) {
      return undefined;
    }
    cache.set(name, fallback);
    return structuredClone(fallback);
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
