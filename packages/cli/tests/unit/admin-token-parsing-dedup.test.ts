import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("@tyrum/cli --elevated-token parsing dedup", () => {
  it("keeps the --elevated-token error messages single-sourced", async () => {
    const sourcePath = fileURLToPath(new URL("../../src/index.ts", import.meta.url));
    const source = await readFile(sourcePath, "utf8");

    const missingValueCount = source.split("--elevated-token requires a value").length - 1;
    expect(missingValueCount).toBe(1);

    const emptyValueCount = source.split("--elevated-token requires a non-empty value").length - 1;
    expect(emptyValueCount).toBe(1);
  });
});
