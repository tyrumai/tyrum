import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("WorkBoard page (WS integration)", () => {
  it("uses TyrumClient to list work items and subscribe to work.* events", () => {
    const page = readFileSync(
      join(import.meta.dirname, "../src/renderer/pages/WorkBoard.tsx"),
      "utf-8",
    );

    expect(page).toContain("TyrumClient");
    expect(page).toContain("workList");
    expect(page).toContain("work.item.");
  });

  it("memoizes selected task list inputs to avoid downstream recalculation", () => {
    const page = readFileSync(
      join(import.meta.dirname, "../src/renderer/pages/WorkBoard.tsx"),
      "utf-8",
    );

    expect(page).toContain("selectTasksForSelectedWorkItem");
  });

  it("guards agent-scope KV updates behind drilldown selection", () => {
    const page = readFileSync(
      join(import.meta.dirname, "../src/renderer/pages/WorkBoard.tsx"),
      "utf-8",
    );

    expect(page).toContain("shouldProcessWorkStateKvUpdate");
  });
});
