import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("WorkBoard drilldown fields", () => {
  it("includes blockers, artifact refs, signal last-fired, and task timestamps", () => {
    const page = readFileSync(
      join(import.meta.dirname, "../src/renderer/pages/WorkBoard.tsx"),
      "utf-8",
    );

    expect(page).toContain("Blockers");
    expect(page).toContain("artifact.refs");
    expect(page).toContain("signal.last_fired_at");
    expect(page).toContain("task.last_event_at");
  });
});

