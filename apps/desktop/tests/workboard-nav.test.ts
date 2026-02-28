import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Desktop navigation wiring", () => {
  it("defines the expected sidebar nav items", () => {
    const layout = readFileSync(
      join(import.meta.dirname, "../src/renderer/components/Layout.tsx"),
      "utf-8",
    );

    expect(layout).toContain('id: "overview"');
    expect(layout).toContain('label: "Overview"');

    expect(layout).toContain('id: "gateway"');
    expect(layout).toContain('label: "Gateway"');

    expect(layout).toContain('id: "connection"');
    expect(layout).toContain('label: "Connection"');

    expect(layout).toContain('id: "permissions"');
    expect(layout).toContain('label: "Permissions"');

    expect(layout).toContain('id: "diagnostics"');
    expect(layout).toContain('label: "Diagnostics"');

    expect(layout).toContain('id: "logs"');
    expect(layout).toContain('label: "Logs"');

    expect(layout).not.toContain('id: "work"');
    expect(layout).not.toContain('id: "memory"');
  });

  it("keeps the work page route for deep links", () => {
    const app = readFileSync(join(import.meta.dirname, "../src/renderer/App.tsx"), "utf-8");

    expect(app).toContain('page === "work"');
    expect(app).toContain("<WorkBoard");
    expect(app).toContain("deepLinkWorkItemId");
  });
});
