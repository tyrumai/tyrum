import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Desktop navigation wiring", () => {
  it("defines the expected sidebar nav items", () => {
    const layout = readFileSync(
      join(import.meta.dirname, "../src/renderer/components/Layout.tsx"),
      "utf-8",
    );

    // Primary nav
    expect(layout).toContain('id: "dashboard"');
    expect(layout).toContain('label: "Dashboard"');

    expect(layout).toContain('id: "approvals"');
    expect(layout).toContain('label: "Approvals"');

    expect(layout).toContain('id: "runs"');
    expect(layout).toContain('label: "Runs"');

    expect(layout).toContain('id: "work"');
    expect(layout).toContain('label: "Work"');

    expect(layout).toContain('id: "memory"');
    expect(layout).toContain('label: "Memory"');

    // Setup nav (secondary collapsible)
    expect(layout).toContain('id: "connection"');
    expect(layout).toContain('label: "Connection"');

    expect(layout).toContain('id: "pairing"');
    expect(layout).toContain('label: "Pairing"');

    expect(layout).toContain('id: "permissions"');
    expect(layout).toContain('label: "Permissions"');

    expect(layout).toContain('id: "settings"');
    expect(layout).toContain('label: "Settings"');

    expect(layout).toContain('id: "debug"');
    expect(layout).toContain('label: "Debug"');

    expect(layout).toContain("secondaryCollapsible");
  });

  it("keeps the work page route for deep links", () => {
    const app = readFileSync(join(import.meta.dirname, "../src/renderer/App.tsx"), "utf-8");

    expect(app).toContain('"work"');
    expect(app).toContain("<WorkBoard");
    expect(app).toContain("deepLinkWorkItemId");
  });
});
