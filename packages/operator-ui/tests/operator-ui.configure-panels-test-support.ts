import { expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createBearerTokenAuth, createOperatorCore } from "../../operator-app/src/index.js";
import { OperatorUiApp } from "../src/index.js";
import { waitForSelector, openConfigureTab } from "./operator-ui.test-support.js";
import { FakeWsClient, createFakeHttpClient } from "./operator-ui.test-fixtures.js";

function registerConfigurePanelsNavTests(): void {
  it("renders a Configure nav item and strict admin section tabs", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    try {
      act(() => {
        root = createRoot(container);
        root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
      });

      const configureLink = container.querySelector<HTMLButtonElement>(
        '[data-testid="nav-configure"]',
      );
      expect(configureLink).not.toBeNull();

      await act(async () => {
        configureLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(await waitForSelector(container, "[data-testid='configure-page']")).not.toBeNull();
      expect(container.querySelector("[data-testid='admin-tab-http']")).toBeNull();
      expect(container.querySelector("[data-testid='admin-tab-ws']")).toBeNull();
      expect(
        await waitForSelector(container, "[data-testid='configure-tab-general']"),
      ).not.toBeNull();
      expect(
        await waitForSelector(container, "[data-testid='admin-http-tab-policy']"),
      ).not.toBeNull();
      expect(
        await waitForSelector(container, "[data-testid='admin-http-tab-providers']"),
      ).not.toBeNull();
      expect(
        await waitForSelector(container, "[data-testid='admin-http-tab-models']"),
      ).not.toBeNull();
      expect(
        await waitForSelector(container, "[data-testid='admin-http-tab-audit']"),
      ).not.toBeNull();
      expect(
        await waitForSelector(container, "[data-testid='admin-http-tab-routing-config']"),
      ).not.toBeNull();
      expect(
        await waitForSelector(container, "[data-testid='admin-http-tab-secrets']"),
      ).not.toBeNull();
      expect(
        await waitForSelector(container, "[data-testid='admin-http-tab-gateway']"),
      ).not.toBeNull();
      expect(
        await waitForSelector(container, "[data-testid='admin-ws-tab-commands']"),
      ).not.toBeNull();
      expect(container.querySelector("[data-elevated-mode-guard]")).toBeNull();
    } finally {
      act(() => {
        root?.unmount();
      });
      container.remove();
    }
  });

  it("renders Configure section panels when Elevated Mode is active", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    core.elevatedModeStore.enter({
      elevatedToken: "elevated-test-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    try {
      act(() => {
        root = createRoot(container);
        root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
      });
      await openConfigureTab(container, "admin-http-tab-gateway");
      expect(container.querySelector("[data-testid='admin-http-tokens']")).not.toBeNull();

      await openConfigureTab(container, "admin-http-tab-providers");
      expect(container.querySelector("[data-testid='admin-http-providers']")).not.toBeNull();

      await openConfigureTab(container, "admin-http-tab-models");
      expect(container.querySelector("[data-testid='admin-http-models']")).not.toBeNull();
    } finally {
      act(() => {
        root?.unmount();
      });
      container.remove();
    }
  });

  it("opens the structured add-token dialog from Configure", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    core.elevatedModeStore.enter({
      elevatedToken: "elevated-test-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    try {
      act(() => {
        root = createRoot(container);
        root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
      });
      await openConfigureTab(container, "admin-http-tab-gateway");
      const issueButton = container.querySelector<HTMLButtonElement>(
        '[data-testid="admin-http-tokens-issue"]',
      );
      expect(issueButton).not.toBeNull();

      act(() => {
        issueButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      const dialog = document.body.querySelector<HTMLElement>(
        '[data-testid="admin-http-token-dialog"]',
      );
      expect(dialog).not.toBeNull();
      expect(dialog?.textContent).toContain("Add token");
      expect(document.body.querySelector('[data-testid="confirm-danger-dialog"]')).toBeNull();
    } finally {
      act(() => {
        root?.unmount();
      });
      container.remove();
    }
  });

  it("requires confirmation before revoking a tenant token from Configure", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    core.elevatedModeStore.enter({
      elevatedToken: "elevated-test-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "http://example.test/auth/tokens" && (!init?.method || init.method === "GET")) {
        return new Response(
          JSON.stringify({
            tokens: [
              {
                token_id: "token-1",
                tenant_id: "11111111-1111-4111-8111-111111111111",
                display_name: "Tyrum",
                role: "client",
                device_id: "tyrum",
                scopes: ["operator.read"],
                issued_at: "2026-02-27T00:00:00.000Z",
                expires_at: "2099-01-01T00:00:00.000Z",
                revoked_at: null,
                created_at: "2026-02-27T00:00:00.000Z",
                updated_at: "2026-02-27T00:00:00.000Z",
              },
            ],
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    try {
      act(() => {
        root = createRoot(container);
        root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
      });
      await openConfigureTab(container, "admin-http-tab-gateway");
      const revokeButton = await waitForSelector<HTMLButtonElement>(
        container,
        '[data-testid="admin-http-token-revoke-token-1"]',
      );
      expect(revokeButton).not.toBeNull();

      act(() => {
        revokeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      const confirmButton = document.body.querySelector<HTMLButtonElement>(
        '[data-testid="confirm-danger-confirm"]',
      );
      expect(confirmButton).not.toBeNull();
      expect(confirmButton?.disabled).toBe(true);

      const checkbox = document.body.querySelector('[data-testid="confirm-danger-checkbox"]');
      expect(checkbox).not.toBeNull();

      act(() => {
        checkbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(confirmButton?.disabled).toBe(false);
    } finally {
      act(() => {
        root?.unmount();
      });
      container.remove();
    }
  });
  it("does not render the deprecated Contracts panel in Configure", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    core.elevatedModeStore.enter({
      elevatedToken: "elevated-test-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    try {
      act(() => {
        root = createRoot(container);
        root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
      });
      await openConfigureTab(container, "admin-http-tab-gateway");
      expect(container.querySelector('[data-testid="admin-http-contracts"]')).toBeNull();
    } finally {
      act(() => {
        root?.unmount();
      });
      container.remove();
    }
  });
}

export function registerConfigurePanelsTests(): void {
  registerConfigurePanelsNavTests();
}
