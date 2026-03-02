import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Admin page dead code", () => {
  it("does not keep legacy Admin page panels and hubs", () => {
    const removed = [
      "packages/operator-ui/src/components/pages/admin-http-panels.tsx",
      "packages/operator-ui/src/components/pages/admin-http-contracts.tsx",

      "packages/operator-ui/src/components/admin-http/admin-http-panels.tsx",
      "packages/operator-ui/src/components/admin-http/agent-status-panel.tsx",
      "packages/operator-ui/src/components/admin-http/artifacts-panel.tsx",
      "packages/operator-ui/src/components/admin-http/context-panel.tsx",
      "packages/operator-ui/src/components/admin-http/health-panel.tsx",

      "packages/operator-ui/src/components/admin/admin-ws-panels.tsx",
      "packages/operator-ui/src/components/admin-ws/json-ws-panel.tsx",
      "packages/operator-ui/src/components/admin-ws/subagents-panels.tsx",

      "packages/operator-ui/src/components/admin-workboard/admin-workboard-ws-hub.tsx",
      "packages/operator-ui/src/components/admin-workboard/work-items-table.tsx",
      "packages/operator-ui/src/components/admin-workboard/work-scope-selector.tsx",
    ];

    for (const path of removed) {
      expect(existsSync(join(process.cwd(), path))).toBe(false);
    }
  });
});
