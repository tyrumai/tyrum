import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Memory inspector navigation wiring", () => {
  it("adds a Memory nav item in the sidebar", () => {
    const sidebar = readFileSync(
      join(import.meta.dirname, "../src/renderer/components/Sidebar.tsx"),
      "utf-8",
    );

    expect(sidebar).toContain('id: "memory"');
    expect(sidebar).toContain('label: "Memory"');
  });

  it("routes the memory page id in the app shell", () => {
    const app = readFileSync(join(import.meta.dirname, "../src/renderer/App.tsx"), "utf-8");

    expect(app).toContain('page === "memory"');
    expect(app).toContain("<Memory");
  });

  it("renders the operator-ui MemoryInspector page", () => {
    const pagePath = join(import.meta.dirname, "../src/renderer/pages/Memory.tsx");

    expect(existsSync(pagePath)).toBe(true);

    const page = readFileSync(pagePath, "utf-8");
    expect(page).toContain('from "@tyrum/operator-ui"');
    expect(page).toContain("<MemoryInspector");
  });
});
