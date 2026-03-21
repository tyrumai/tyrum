import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

describe("generated API artifacts", () => {
  it("match the generator output", async () => {
    const generator = await import(
      pathToFileURL(resolve(repoRoot, "scripts/api/generator-lib.mjs")).href
    );
    const generated = await generator.generateApiArtifacts();

    for (const file of generated.files as Array<{ path: string; content: string }>) {
      const existing = await readFile(file.path, "utf8");
      expect(existing).toBe(file.content);
    }
  });

  it("generate OpenAPI paths only for valid HTTP routes", async () => {
    const openApi = JSON.parse(await readFile(resolve(repoRoot, "specs/openapi.json"), "utf8")) as {
      paths?: Record<string, unknown>;
    };
    const paths = Object.keys(openApi.paths ?? {});

    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path.startsWith("/")).toBe(true);
    }
    expect(paths).not.toContain("authClaims");
    expect(paths).not.toContain("x-request-id");
    expect(paths).not.toContain(
      "SELECT plan_id FROM plans WHERE tenant_id = ? AND plan_id = ? FOR UPDATE",
    );
  });
});
