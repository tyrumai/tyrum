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

  it("subscribes to work.item.failed to keep the board in sync", () => {
    const page = readFileSync(
      join(import.meta.dirname, "../src/renderer/pages/WorkBoard.tsx"),
      "utf-8",
    );

    expect(page).toContain('wsClient.on("work.item.failed"');
    expect(page).toContain('wsClient.off("work.item.failed"');
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

  it("renders task metadata when approval_id is 0", () => {
    const page = readFileSync(
      join(import.meta.dirname, "../src/renderer/pages/WorkBoard.tsx"),
      "utf-8",
    );

    expect(page).toMatch(
      /task\.run_id\s*\|\|\s*typeof task\.approval_id === "number"\s*\|\|\s*task\.result_summary/,
    );
  });

  it("rechecks selection after KV async fetch resolves", () => {
    const page = readFileSync(
      join(import.meta.dirname, "../src/renderer/pages/WorkBoard.tsx"),
      "utf-8",
    );

    expect(page).toContain("shouldProcessWorkStateKvUpdate(scope, selectedIdRef.current)");
  });

  it("dedupes the Blockers filter predicate", () => {
    const page = readFileSync(
      join(import.meta.dirname, "../src/renderer/pages/WorkBoard.tsx"),
      "utf-8",
    );

    expect(page).toContain("const approvalBlockers");
    expect(page).toContain("approvalBlockers.length === 0");
    expect(page).toContain("approvalBlockers.map");
  });

  it("rechecks selection before applying workTransition responses", () => {
    const page = readFileSync(
      join(import.meta.dirname, "../src/renderer/pages/WorkBoard.tsx"),
      "utf-8",
    );

    expect(page).toMatch(
      /workTransition[\s\S]*setSelectedItem\([\s\S]*selectedIdRef\.current\s*!==\s*res\.item\.work_item_id/,
    );
  });

  it("subscribes to work.item.failed events so UI stays consistent", () => {
    const page = readFileSync(
      join(import.meta.dirname, "../src/renderer/pages/WorkBoard.tsx"),
      "utf-8",
    );

    expect(page).toContain('wsClient.on("work.item.failed"');
    expect(page).toContain('wsClient.off("work.item.failed"');
  });

  it("adds a triage control to move backlog work items to ready", () => {
    const page = readFileSync(
      join(import.meta.dirname, "../src/renderer/pages/WorkBoard.tsx"),
      "utf-8",
    );

    expect(page).toContain("Mark Ready");
    expect(page).toContain('transitionSelected("ready"');
  });

  it("includes cancel/resume controls wired to work.transition", () => {
    const page = readFileSync(
      join(import.meta.dirname, "../src/renderer/pages/WorkBoard.tsx"),
      "utf-8",
    );

    expect(page).toContain("Resume");
    expect(page).toContain('transitionSelected("doing"');
    expect(page).toContain("Cancel");
    expect(page).toContain('transitionSelected("cancelled"');
  });
});
