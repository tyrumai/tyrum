import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("work overlap warning", () => {
  it("does not duplicate the overlap-warning body template", async () => {
    const handlerSource = await readFile(
      new URL("../../src/ws/protocol/workboard-overlap-warning.ts", import.meta.url),
      {
        encoding: "utf8",
      },
    );

    const marker = "Detected overlap with active WorkItems (no auto-merge):";
    const occurrences = handlerSource.split(marker).length - 1;
    expect(occurrences).toBe(1);
  });
});
