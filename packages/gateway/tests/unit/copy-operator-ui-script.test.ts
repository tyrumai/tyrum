import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readCopyScript(): string {
  const scriptPath = fileURLToPath(new URL("../../scripts/copy-operator-ui.mjs", import.meta.url));
  return readFileSync(scriptPath, "utf8");
}

describe("copy-operator-ui script", () => {
  it("rebuilds the web UI before copying bundled /ui assets", () => {
    const script = readCopyScript();
    const buildCallIndex = script.indexOf("tryBuildWeb(repoRoot);");
    const sourceCheckIndex = script.indexOf("if (!existsSync(sourceIndex)) {");

    expect(buildCallIndex).toBeGreaterThanOrEqual(0);
    expect(sourceCheckIndex).toBeGreaterThanOrEqual(0);
    expect(buildCallIndex).toBeLessThan(sourceCheckIndex);
  });

  it("verifies the copied bundle references assets that exist under dist/ui", () => {
    const script = readCopyScript();
    expect(script).toContain("function verifyCopiedOperatorUiBuild(destDir)");
    expect(script).toContain('resourcePath.startsWith("/ui/")');
    expect(script).toContain("verifyCopiedOperatorUiBuild(destDir);");
  });
});
