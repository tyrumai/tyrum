// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { DashboardPage } from "../../src/components/pages/dashboard-page.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";
import { createMockCore } from "./dashboard-page.test-support.js";

describe("DashboardPage configuration health", () => {
  it("shows a summary-first configuration health list and expands on demand", () => {
    const { core, setConnectionState, setStatusState } = createMockCore();
    act(() => {
      setConnectionState((prev) => ({ ...prev, status: "connected" }));
      setStatusState((prev) => ({
        ...prev,
        status: {
          version: "1.0.0",
          db_kind: "sqlite",
          auth: { enabled: true },
          sandbox: null,
          policy: null,
          is_exposed: false,
          config_health: {
            status: "issues",
            issues: [
              {
                code: "agent_model_unconfigured",
                severity: "error",
                message: "Agent 'default' has no primary model configured.",
                target: { kind: "agent", id: "default" },
              },
              {
                code: "no_provider_accounts",
                severity: "error",
                message: "No active provider accounts are configured.",
                target: { kind: "deployment", id: null },
              },
              {
                code: "no_model_presets",
                severity: "warning",
                message: "No model presets are configured.",
                target: { kind: "deployment", id: null },
              },
              {
                code: "execution_profile_unassigned",
                severity: "warning",
                message: "Execution profile 'planner' is set to None.",
                target: { kind: "execution_profile", id: "planner" },
              },
            ],
          },
        },
      }));
    });

    const { container, root } = renderIntoDocument(React.createElement(DashboardPage, { core }));

    expect(container.textContent).toContain("2 errors");
    expect(container.textContent).toContain("2 warnings");
    expect(container.textContent).toContain("Showing 3 of 4 issues.");
    expect(container.textContent).toContain("1 more issues hidden until you expand this list.");
    expect(container.textContent).not.toContain("Execution profile 'planner' is set to None.");

    const expandButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="dashboard-config-health-toggle"]',
    );
    expect(expandButton?.textContent).toContain("Show all 4 issues");

    act(() => {
      expandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Execution profile 'planner' is set to None.");
    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="dashboard-config-health-toggle"]')
        ?.textContent,
    ).toContain("Show fewer issues");

    cleanupTestRoot({ container, root });
  });
});
