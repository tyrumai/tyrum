import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("memory cosineSimilarity dedup", () => {
  it("exports cosineSimilarity from vector-dal", async () => {
    const mod = (await import("../../src/modules/memory/vector-dal.js")) as any;
    expect(typeof mod.cosineSimilarity).toBe("function");

    const cosineSimilarity = mod.cosineSimilarity as (a: number[], b: number[]) => number;
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([-1, 0], [1, 0])).toBe(-1);
  });

  it("does not define a local cosineSimilarity in v1-semantic-index", async () => {
    const semanticIndexPath = join(__dirname, "../../src/modules/memory/v1-semantic-index.ts");
    const raw = await readFile(semanticIndexPath, "utf-8");
    expect(raw).not.toMatch(/\bfunction\s+cosineSimilarity\b/);
  });
});
