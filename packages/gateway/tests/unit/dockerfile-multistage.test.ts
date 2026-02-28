import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

function collectFromLineIndexes(dockerfile: string): number[] {
  const lines = dockerfile.split(/\r?\n/);
  const indexes: number[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trimStart() ?? "";
    if (line.toUpperCase().startsWith("FROM ")) indexes.push(i);
  }

  return indexes;
}

describe("Dockerfile (multi-stage build)", () => {
  const dockerfileUrl = new URL("../../../../Dockerfile", import.meta.url);

  test("uses a builder and production stage", () => {
    const dockerfile = readFileSync(fileURLToPath(dockerfileUrl), "utf8");

    expect(dockerfile).toMatch(/^FROM\s+.+\s+AS\s+builder\b/im);
    expect(dockerfile).toMatch(/^FROM\s+.+\s+AS\s+production\b/im);
    expect(collectFromLineIndexes(dockerfile).length).toBeGreaterThanOrEqual(2);
  });

  test("does not install build tools in the final stage", () => {
    const dockerfile = readFileSync(fileURLToPath(dockerfileUrl), "utf8");
    const fromIndexes = collectFromLineIndexes(dockerfile);
    expect(fromIndexes.length).toBeGreaterThanOrEqual(2);

    const lines = dockerfile.split(/\r?\n/);
    const finalStageStart = fromIndexes.at(-1) ?? 0;
    const finalStage = lines.slice(finalStageStart).join("\n");

    expect(finalStage).not.toMatch(/\bpython3\b/i);
    expect(finalStage).not.toMatch(/g\+\+/i);
    expect(finalStage).not.toMatch(/\bmake\b/i);
  });
});
