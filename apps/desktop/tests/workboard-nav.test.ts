import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("WorkBoard navigation wiring", () => {
  it("adds a Work nav item in the sidebar", () => {
    const sidebar = readFileSync(
      join(import.meta.dirname, "../src/renderer/components/Sidebar.tsx"),
      "utf-8",
    );

    expect(sidebar).toContain('id: "work"');
    expect(sidebar).toContain('label: "Work"');
  });

  it("routes the work page id in the app shell", () => {
    const app = readFileSync(join(import.meta.dirname, "../src/renderer/App.tsx"), "utf-8");

    expect(app).toContain('page === "work"');
    expect(app).toContain("<WorkBoard />");
  });
});
