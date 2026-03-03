// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import type { OperatorCore } from "../../operator-core/src/index.js";
import { createElevatedModeStore } from "../../operator-core/src/stores/elevated-mode-store.js";
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
  it("trims inputs and uses the elevated admin token for audit actions", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url === "http://example.test/audit/export/plan-123") {
        return new Response(
          JSON.stringify({
            plan_id: "plan-123",
            events: [],
            chain_verification: {
              valid: true,
              checked_count: 0,
              broken_at_index: null,
              broken_at_id: null,
            },
            exported_at: "2026-03-01T00:00:00.000Z",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (url === "http://example.test/audit/forget") {
        return new Response(
          JSON.stringify({ decision: "delete", deleted_count: 0, proof_event_id: 0 }),
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

      const planIdInput = panel?.querySelector<HTMLInputElement>(
        'input[placeholder="agent-turn-default-..."]',
      );
      expect(planIdInput).not.toBeNull();

      act(() => {
        setNativeValue(planIdInput!, "  plan-123  ");
      });

      const exportButton = Array.from(panel?.querySelectorAll("button") ?? []).find((button) =>
        button.textContent?.includes("Export receipt bundle"),
      );
      expect(exportButton).toBeDefined();

      await act(async () => {
        exportButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [exportInput, exportInit] = fetchMock.mock.calls[0] ?? [];
      const exportUrl =
        typeof exportInput === "string"
          ? exportInput
          : exportInput instanceof URL
            ? exportInput.toString()
            : exportInput.url;
      expect(exportUrl).toBe("http://example.test/audit/export/plan-123");
      expect(exportInit?.method).toBe("GET");
      expect(new Headers(exportInit?.headers).get("authorization")).toBe(
        "Bearer elevated-test-token",
      );

      const entityTypeInput = panel?.querySelector<HTMLInputElement>(
        'input[placeholder="user | session | ..."]',
      );
      const entityIdInput = panel?.querySelector<HTMLInputElement>('input[placeholder="..."]');
      expect(entityTypeInput).not.toBeNull();
      expect(entityIdInput).not.toBeNull();

      act(() => {
        setNativeValue(entityTypeInput!, "  user  ");
        setNativeValue(entityIdInput!, "  123  ");
      });

      const forgetButton = Array.from(panel?.querySelectorAll("button") ?? []).find((button) =>
        button.textContent?.includes("Forget…"),
      );
      expect(forgetButton).toBeDefined();
      act(() => {
        forgetButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

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

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [forgetInput, forgetInit] = fetchMock.mock.calls[1] ?? [];
      const forgetUrl =
        typeof forgetInput === "string"
          ? forgetInput
          : forgetInput instanceof URL
            ? forgetInput.toString()
            : forgetInput.url;
      expect(forgetUrl).toBe("http://example.test/audit/forget");
      expect(forgetInit?.method).toBe("POST");
      expect(new Headers(forgetInit?.headers).get("authorization")).toBe(
        "Bearer elevated-test-token",
      );
      expect(JSON.parse(String(forgetInit?.body ?? ""))).toEqual({
        confirm: "FORGET",
        entity_type: "user",
        entity_id: "123",
        decision: "delete",
      });
    } finally {
      cleanupTestRoot(testRoot);
    }
  });
});
