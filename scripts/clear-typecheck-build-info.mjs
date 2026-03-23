import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

for (const relativePath of [
  "packages/contracts/tsconfig.tsbuildinfo",
  "packages/runtime-policy/tsconfig.tsbuildinfo",
  "packages/transport-sdk/tsconfig.tsbuildinfo",
  "packages/runtime-node-control/tsconfig.tsbuildinfo",
  "packages/runtime-execution/tsconfig.tsbuildinfo",
  "packages/runtime-agent/tsconfig.tsbuildinfo",
  "packages/runtime-workboard/tsconfig.tsbuildinfo",
  "packages/gateway/tsconfig.tsbuildinfo",
]) {
  rmSync(resolve(REPO_ROOT, relativePath), { force: true });
}
