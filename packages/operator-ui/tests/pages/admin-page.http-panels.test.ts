// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { createAdminModeStore } from "../../../operator-core/src/stores/admin-mode-store.js";
import { AdminModeProvider } from "../../src/admin-mode.js";
import { AdminPage } from "../../src/components/pages/admin-page.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) {
    setter.call(element, value);
  }
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("AdminPage (HTTP panels)", () => {
  it("renders HTTP Observability + Models panels and wires actions", async () => {
    const nowMs = Date.parse("2026-01-01T00:00:00.000Z");
    const adminModeStore = createAdminModeStore({ tickIntervalMs: 0, now: () => nowMs });
    adminModeStore.enter({
      elevatedToken: "test-elevated-token",
      expiresAt: "2026-01-01T00:10:00.000Z",
    });

    const http = {
      status: { get: vi.fn(async () => ({ status: "ok" })) },
      usage: { get: vi.fn(async () => ({ status: "ok" })) },
      presence: { list: vi.fn(async () => ({ status: "ok", entries: [] })) },
      pairings: {
        list: vi.fn(async () => ({ status: "ok", pairings: [] })),
        approve: vi.fn(async () => ({ status: "ok", pairing: { pairing_id: 123 } })),
        deny: vi.fn(async () => ({ status: "ok", pairing: { pairing_id: 123 } })),
        revoke: vi.fn(async () => ({ status: "ok", pairing: { pairing_id: 123 } })),
      },
      models: {
        status: vi.fn(async () => ({ status: "ok" })),
        refresh: vi.fn(async () => ({ status: "ok" })),
        listProviders: vi.fn(async () => ({ status: "ok", providers: [] })),
        getProvider: vi.fn(async () => ({ status: "ok" })),
        listProviderModels: vi.fn(async () => ({ status: "ok" })),
      },
    };

    const core = {
      httpBaseUrl: "http://example.test",
      adminModeStore,
      http,
    } as unknown as OperatorCore;

    const testRoot = renderIntoDocument(
      React.createElement(
        AdminModeProvider,
        { core, mode: "web" },
        React.createElement(AdminPage, { core }),
      ),
    );

    try {
      expect(testRoot.container.querySelector("[data-testid='admin-tab-http']")).not.toBeNull();

      expect(
        testRoot.container.querySelector("[data-testid='admin-http-tab-observability']"),
      ).not.toBeNull();
      expect(
        testRoot.container.querySelector("[data-testid='admin-http-tab-models']"),
      ).not.toBeNull();

      const statusButton = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='admin-http-status-get']",
      );
      expect(statusButton).not.toBeNull();
      await act(async () => {
        statusButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });
      expect(http.status.get).toHaveBeenCalledTimes(1);

      const modelsTab = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='admin-http-tab-models']",
      );
      expect(modelsTab).not.toBeNull();
      await act(async () => {
        modelsTab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
        await Promise.resolve();
      });

      const listProvidersButton = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='admin-http-models-providers-list']",
      );
      expect(listProvidersButton).not.toBeNull();
      await act(async () => {
        listProvidersButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });
      expect(http.models.listProviders).toHaveBeenCalledTimes(1);

      const refreshButton = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='admin-http-models-refresh']",
      );
      expect(refreshButton).not.toBeNull();

      act(() => {
        refreshButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(document.querySelector("[data-testid='confirm-danger-dialog']")).not.toBeNull();
      expect(http.models.refresh).toHaveBeenCalledTimes(0);

      const checkbox = document.querySelector<HTMLInputElement>(
        "[data-testid='confirm-danger-checkbox']",
      );
      expect(checkbox).not.toBeNull();
      act(() => {
        checkbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      const confirmButton = document.querySelector<HTMLButtonElement>(
        "[data-testid='confirm-danger-confirm']",
      );
      expect(confirmButton).not.toBeNull();
      await act(async () => {
        confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });
      expect(http.models.refresh).toHaveBeenCalledTimes(1);

      const obsTab = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='admin-http-tab-observability']",
      );
      expect(obsTab).not.toBeNull();
      await act(async () => {
        obsTab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
        await Promise.resolve();
      });

      const pairingId = testRoot.container.querySelector<HTMLInputElement>(
        "[data-testid='admin-http-pairings-mutate-id']",
      );
      expect(pairingId).not.toBeNull();
      act(() => {
        if (!pairingId) return;
        setNativeValue(pairingId, "123");
      });

      const pairingBody = testRoot.container.querySelector<HTMLTextAreaElement>(
        "[data-testid='admin-http-pairings-mutate-body']",
      );
      expect(pairingBody).not.toBeNull();
      act(() => {
        if (!pairingBody) return;
        setNativeValue(
          pairingBody,
          JSON.stringify({ trust_level: "local", capability_allowlist: [] }),
        );
      });

      const approveButton = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='admin-http-pairings-approve']",
      );
      expect(approveButton).not.toBeNull();
      act(() => {
        approveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(document.querySelector("[data-testid='confirm-danger-dialog']")).not.toBeNull();
      expect(http.pairings.approve).toHaveBeenCalledTimes(0);

      const approveCheckbox = document.querySelector<HTMLInputElement>(
        "[data-testid='confirm-danger-checkbox']",
      );
      expect(approveCheckbox).not.toBeNull();
      act(() => {
        approveCheckbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      const approveConfirm = document.querySelector<HTMLButtonElement>(
        "[data-testid='confirm-danger-confirm']",
      );
      expect(approveConfirm).not.toBeNull();
      await act(async () => {
        approveConfirm?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(http.pairings.approve).toHaveBeenCalledTimes(1);
      expect(http.pairings.approve).toHaveBeenCalledWith(123, {
        trust_level: "local",
        capability_allowlist: [],
      });
    } finally {
      adminModeStore.dispose();
      cleanupTestRoot(testRoot);
    }
  });
});
