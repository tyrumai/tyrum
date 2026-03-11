import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

async function ensureBuilt(pkgName) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("pnpm", ["--filter", pkgName, "build"], {
      cwd: repoRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(`Failed to build ${pkgName} (exit ${String(code)})`));
    });
    child.on("error", rejectPromise);
  });
}

await ensureBuilt("@tyrum/schemas");
await ensureBuilt("@tyrum/client");
await ensureBuilt("@tyrum/operator-core");
await ensureBuilt("@tyrum/operator-ui");
