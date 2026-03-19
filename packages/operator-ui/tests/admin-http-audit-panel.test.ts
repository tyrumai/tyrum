// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import type { OperatorCore } from "../../operator-app/src/index.js";
import { createElevatedModeStore } from "../../operator-app/src/stores/elevated-mode-store.js";
import { ElevatedModeProvider } from "../src/elevated-mode.js";
import { AuditPanel } from "../src/components/admin-http/audit-panel.js";
import { cleanupTestRoot, renderIntoDocument, setNativeValue } from "./test-utils.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function createCore(): OperatorCore {
  const elevatedModeStore = createElevatedModeStore({
    tickIntervalMs: 0,
    now: () => Date.parse("2026-03-01T00:00:00.000Z"),
  });
  elevatedModeStore.enter({
    elevatedToken: "elevated-test-token",
    expiresAt: "2026-03-01T00:10:00.000Z",
  });

  return {
    httpBaseUrl: "http://example.test",
    elevatedModeStore,
  } as unknown as OperatorCore;
}

describe("AuditPanel", () => {
  it("loads recent plans, hides verify/json UI, and exports the selected plan", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url === "http://example.test/audit/plans?limit=100") {
        return new Response(
          JSON.stringify({
            status: "ok",
            plans: [
              {
                plan_key: "plan-123",
                plan_id: "00000000-0000-4000-8000-000000000123",
                kind: "planner",
                status: "success",
                event_count: 3,
                last_event_at: "2026-03-01T00:00:00.000Z",
              },
              {
                plan_key: "plan-999",
                plan_id: "00000000-0000-4000-8000-000000000999",
                kind: "audit",
                status: "active",
                event_count: 1,
                last_event_at: "2026-03-01T00:05:00.000Z",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (url === "http://example.test/audit/export/plan-999") {
        expect(init?.method).toBe("GET");
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer elevated-test-token");
        return new Response(
          JSON.stringify({
            plan_id: "00000000-0000-4000-8000-000000000999",
            events: [],
            chain_verification: {
              valid: true,
              checked_count: 0,
              broken_at_index: null,
              broken_at_id: null,
            },
            exported_at: "2026-03-01T00:06:00.000Z",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const core = createCore();
    const testRoot = renderIntoDocument(
      React.createElement(
        ElevatedModeProvider,
        { core, mode: "web" },
        React.createElement(AuditPanel, { core }),
      ),
    );

    try {
      const panel = testRoot.container.querySelector<HTMLElement>(
        "[data-testid='admin-http-audit-panel']",
      );
      expect(panel).not.toBeNull();

      await act(async () => {
        await Promise.resolve();
      });

      expect(panel?.textContent).toContain("Audit receipts");
      expect(panel?.textContent).not.toContain("Verify");
      expect(panel?.querySelector("textarea")).toBeNull();

      const filterInput = panel?.querySelector<HTMLInputElement>(
        '[data-testid="audit-plan-filter"]',
      );
      expect(filterInput).not.toBeNull();

      await act(async () => {
        setNativeValue(filterInput!, "999");
        await Promise.resolve();
      });

      expect(panel?.textContent).toContain("plan-999");

      const exportButton = Array.from(panel?.querySelectorAll("button") ?? []).find((button) =>
        button.textContent?.includes("Export receipt bundle"),
      );
      expect(exportButton).toBeDefined();

      await act(async () => {
        exportButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(panel?.textContent).toContain("Download receipt bundle");
      expect(panel?.textContent).toContain("Valid");
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("forgets the selected plan using the fixed plan delete payload", async () => {
    let plansRequestCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url === "http://example.test/audit/plans?limit=100") {
        plansRequestCount += 1;
        const eventCount = plansRequestCount === 1 ? 4 : 1;
        return new Response(
          JSON.stringify({
            status: "ok",
            plans: [
              {
                plan_key: "plan-123",
                plan_id: "00000000-0000-4000-8000-000000000123",
                kind: "planner",
                status: "success",
                event_count: eventCount,
                last_event_at: "2026-03-01T00:00:00.000Z",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (url === "http://example.test/audit/forget") {
        expect(init?.method).toBe("POST");
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer elevated-test-token");
        expect(JSON.parse(String(init?.body ?? ""))).toEqual({
          confirm: "FORGET",
          entity_type: "plan",
          entity_id: "plan-123",
          decision: "delete",
        });
        return new Response(
          JSON.stringify({ decision: "delete", deleted_count: 4, proof_event_id: 5 }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const core = createCore();
    const testRoot = renderIntoDocument(
      React.createElement(
        ElevatedModeProvider,
        { core, mode: "web" },
        React.createElement(AuditPanel, { core }),
      ),
    );

    try {
      const panel = testRoot.container.querySelector<HTMLElement>(
        "[data-testid='admin-http-audit-panel']",
      );
      expect(panel).not.toBeNull();

      await act(async () => {
        await Promise.resolve();
      });

      const forgetButton = Array.from(panel?.querySelectorAll("button") ?? []).find((button) =>
        button.textContent?.includes("Forget audit receipts"),
      );
      expect(forgetButton).toBeDefined();

      act(() => {
        forgetButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(document.body.textContent).toContain("plan-123");

      const checkbox = document.body.querySelector('[data-testid="confirm-danger-checkbox"]');
      expect(checkbox).not.toBeNull();
      act(() => {
        checkbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      const confirmButton = document.body.querySelector<HTMLButtonElement>(
        '[data-testid="confirm-danger-confirm"]',
      );
      expect(confirmButton).not.toBeNull();

      await act(async () => {
        confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(panel?.textContent).toContain("Deleted receipts");
      expect(panel?.textContent).toContain("4");
    } finally {
      cleanupTestRoot(testRoot);
    }
  });
});
