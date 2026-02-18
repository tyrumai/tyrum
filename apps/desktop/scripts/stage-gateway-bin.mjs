import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(scriptDir, "..");

const sourcePath = join(desktopRoot, "../../packages/gateway/dist/index.mjs");
const targetPath = join(desktopRoot, "dist/gateway/index.mjs");

if (!existsSync(sourcePath)) {
  throw new Error(
    `Gateway bundle not found at ${sourcePath}. Run "pnpm --filter @tyrum/gateway build" first.`,
  );
}

mkdirSync(dirname(targetPath), { recursive: true });
copyFileSync(sourcePath, targetPath);

console.log(`Staged embedded gateway bundle: ${sourcePath} -> ${targetPath}`);
