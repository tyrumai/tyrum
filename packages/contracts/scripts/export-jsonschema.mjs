import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(__dirname, "../package.json");
const pkgRaw = await readFile(pkgPath, "utf-8");
const pkg = JSON.parse(pkgRaw);

const distPath = join(__dirname, "../dist/index.mjs");
const dist = await import(pathToFileURL(distPath).href);
const outDir = join(__dirname, "../dist/jsonschema");

await mkdir(outDir, { recursive: true });

function isMissingPathError(error) {
  return error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

async function writeJsonSchemaFile(filename, content) {
  const outputPath = join(outDir, filename);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await mkdir(outDir, { recursive: true });
    const stagingPath = `${outputPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    try {
      await writeFile(stagingPath, content, "utf-8");
      await rename(stagingPath, outputPath);
      return;
    } catch (error) {
      if (!isMissingPathError(error) || attempt === 2) {
        throw error;
      }
    }
  }
}

const generatedAt = new Date().toISOString();
const schemas = [];
const errors = [];
const generatedFiles = new Map();

for (const [name, value] of Object.entries(dist)) {
  if (!value || typeof value !== "object") continue;
  const toJSONSchema = value.toJSONSchema;
  if (typeof toJSONSchema !== "function") continue;

  try {
    // Publish contract schemas as the accepted input shape. This avoids JSON Schema
    // export failures for schemas that normalize output (for example via transforms).
    const schema = toJSONSchema.call(value, { io: "input" });
    if (!schema || typeof schema !== "object") continue;

    const id = `https://contracts.tyrum.dev/${pkg.version}/${encodeURIComponent(name)}.json`;
    if (!("$id" in schema)) schema.$id = id;
    if (!("title" in schema)) schema.title = name;

    const filename = `${name}.json`;
    generatedFiles.set(filename, `${JSON.stringify(schema, null, 2)}\n`);
    schemas.push({ name, file: `jsonschema/${filename}`, $id: id });
  } catch (err) {
    errors.push({ name, error: err instanceof Error ? err.message : String(err) });
  }
}

schemas.sort((a, b) => a.name.localeCompare(b.name));

const catalog = {
  format: "tyrum.contracts.jsonschema.catalog.v1",
  generated_at: generatedAt,
  package: { name: pkg.name, version: pkg.version },
  schemas,
  errors: errors.length > 0 ? errors : undefined,
};

for (const [filename, content] of generatedFiles) {
  await writeJsonSchemaFile(filename, content);
}

const catalogFilename = "catalog.json";
generatedFiles.set(catalogFilename, `${JSON.stringify(catalog, null, 2)}\n`);
await writeJsonSchemaFile(catalogFilename, generatedFiles.get(catalogFilename));

let entries;
try {
  entries = await readdir(outDir, { withFileTypes: true });
} catch (error) {
  if (isMissingPathError(error)) {
    entries = [];
  } else {
    throw error;
  }
}

for (const entry of entries) {
  if (!entry.isFile()) continue;
  if (!entry.name.endsWith(".json")) continue;
  if (generatedFiles.has(entry.name)) continue;
  await rm(join(outDir, entry.name), { force: true });
}

if (errors.length > 0) {
  process.stderr.write(
    `[schemas] JSON Schema export skipped ${errors.length} exports (see catalog.json errors)\n`,
  );
}
