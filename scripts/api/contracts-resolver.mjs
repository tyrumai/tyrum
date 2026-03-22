import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { contractsCatalogPath, repoRoot } from "./paths.mjs";
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

export async function readContractsCatalog() {
  try {
    const raw = await readFile(contractsCatalogPath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    const code = error && typeof error === "object" ? error.code : undefined;
    if (code !== "ENOENT") {
      throw error;
    }
  }

  ensureContractsArtifacts();
  const raw = await readFile(contractsCatalogPath, "utf8");
  return JSON.parse(raw);
}

export async function buildContractSchemaResolver() {
  const catalog = await readContractsCatalog();
  const schemaPathByName = new Map();
  for (const entry of catalog.schemas ?? []) {
    if (!entry?.name || !entry?.file) continue;
    schemaPathByName.set(entry.name, join(repoRoot, "packages/contracts/dist", entry.file));
  }
  const cache = new Map();

  async function getSchema(name) {
    if (cache.has(name)) {
      return structuredClone(cache.get(name));
    }
    const path = schemaPathByName.get(name);
    if (!path) return undefined;
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    cache.set(name, parsed);
    return structuredClone(parsed);
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
