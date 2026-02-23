import { readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(__dirname, "../package.json");
const pkgRaw = await readFile(pkgPath, "utf-8");
const pkg = JSON.parse(pkgRaw);

const distPath = join(__dirname, "../dist/index.mjs");
const dist = await import(pathToFileURL(distPath).href);
const outDir = join(__dirname, "../dist/jsonschema");

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const generatedAt = new Date().toISOString();
const schemas = [];
const errors = [];

for (const [name, value] of Object.entries(dist)) {
  if (!value || typeof value !== "object") continue;
  const toJSONSchema = value.toJSONSchema;
  if (typeof toJSONSchema !== "function") continue;

  try {
    // Publish contract schemas as the accepted input shape. This avoids JSON Schema
    // export failures for schemas that normalize output (for example via transforms).
    const schema = toJSONSchema.call(value, { io: "input" });
    if (!schema || typeof schema !== "object") continue;

    const id = `https://schemas.tyrum.dev/${pkg.version}/${encodeURIComponent(name)}.json`;
    if (!("$id" in schema)) schema.$id = id;
    if (!("title" in schema)) schema.title = name;

    const filename = `${name}.json`;
    await writeFile(join(outDir, filename), `${JSON.stringify(schema, null, 2)}\n`, "utf-8");
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

await writeFile(join(outDir, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`, "utf-8");

if (errors.length > 0) {
  // eslint-disable-next-line no-console
  console.warn(`[schemas] JSON Schema export skipped ${errors.length} exports (see catalog.json errors)`);
}
