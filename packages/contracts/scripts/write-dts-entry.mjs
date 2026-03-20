import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const distDir = join(import.meta.dirname, "..", "dist");
const files = readdirSync(distDir);

const declarationChunk = files.find((fileName) =>
  /^index(?:-[A-Za-z0-9_-]+)?\.d\.(?:ts|mts)$/.test(fileName),
);

if (!declarationChunk) {
  throw new Error(
    "Unable to locate bundled declaration chunk in dist/. Expected index-*.d.ts or index.d.mts.",
  );
}

const entryFile = join(distDir, "index.d.ts");
const entryContents = `export * from "./${declarationChunk}";\n`;

writeFileSync(entryFile, entryContents, "utf8");
