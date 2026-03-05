import { describe, expect, it } from "vitest";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

describe("Issue #998 test conventions", () => {
  it("documents where each test scope belongs", async () => {
    const contributing = await readFile(resolve(repoRoot, "CONTRIBUTING.md"), "utf8");

    expect(contributing).toMatch(/^## (?:\d+\.\s+)?Test Conventions$/m);
    expect(contributing).toMatch(/`tests\/unit\/`/);
    expect(contributing).toMatch(/`tests\/integration\/`/);
    expect(contributing).toMatch(/`tests\/e2e\/`/);
    expect(contributing).toMatch(/`tests\/contract\/`/);
    expect(contributing).toMatch(/`tests\/conformance\/`/);
    expect(contributing).toMatch(/If a package only has one test scope.*`tests\/`/s);
    expect(contributing).toMatch(/avoid repeating the scope in the file name/i);
    expect(contributing).toMatch(/`tests\/e2e\/dispatch\.test\.ts`/);
  });

  it("moves representative end-to-end tests into tests/e2e", async () => {
    const gatewayE2e = resolve(
      repoRoot,
      "packages/gateway/tests/e2e/client-dispatch-smoke.test.ts",
    );
    const oldGatewayLocation = resolve(
      repoRoot,
      "packages/gateway/tests/integration/e2e-smoke.test.ts",
    );
    const desktopE2e = resolve(repoRoot, "apps/desktop/tests/e2e/desktop-dispatch.test.ts");
    const oldDesktopLocation = resolve(
      repoRoot,
      "apps/desktop/tests/integration/e2e-dispatch.test.ts",
    );

    expect(await pathExists(gatewayE2e)).toBe(true);
    expect(await pathExists(oldGatewayLocation)).toBe(false);
    expect(await pathExists(desktopE2e)).toBe(true);
    expect(await pathExists(oldDesktopLocation)).toBe(false);
  });
});
