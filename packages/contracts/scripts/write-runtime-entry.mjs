import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const distDir = join(import.meta.dirname, "..", "dist");

const mjsEntry = join(distDir, "index.mjs");
const jsBundle = join(distDir, "index.js");

// Newer tsdown builds already emit index.mjs. Older installs emit index.js.
// Keep exports stable by ensuring index.mjs exists in both cases.
if (!existsSync(mjsEntry) && existsSync(jsBundle)) {
  writeFileSync(
    mjsEntry,
    'export * from "./index.js";\nexport { default } from "./index.js";\n',
    "utf8",
  );
}
