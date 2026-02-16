import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const distDir = join(import.meta.dirname, "..", "dist");
const files = readdirSync(distDir);

const declarationChunk = files.find((fileName) =>
  /^index-[A-Za-z0-9_-]+\.d\.ts$/.test(fileName),
);

if (!declarationChunk) {
  throw new Error(
    "Unable to locate bundled declaration chunk in dist/. Expected index-*.d.ts.",
  );
}

const declarationStem = declarationChunk.replace(/\.d\.ts$/, "");
const entryFile = join(distDir, "index.d.ts");
const entryContents = `export * from "./${declarationStem}.d.ts";\n`;

writeFileSync(entryFile, entryContents, "utf8");
