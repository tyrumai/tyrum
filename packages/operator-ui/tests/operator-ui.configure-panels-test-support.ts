import { expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  createBearerTokenAuth,
  createOperatorCore,
} from "../../operator-core/src/index.js";
import { OperatorUiApp } from "../src/index.js";
import {
  waitForSelector,
  openConfigureTab,
  setControlledInputValue,
} from "./operator-ui.test-support.js";
import { FakeWsClient, createFakeHttpClient } from "./operator-ui.test-fixtures.js";

export function registerConfigurePanelsTests(): void {
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
        await waitForSelector(container, "[data-testid='admin-http-tab-plugins']"),
      ).not.toBeNull();
      expect(
        await waitForSelector(container, "[data-testid='admin-http-tab-gateway']"),
      ).not.toBeNull();
      expect(
        await waitForSelector(container, "[data-testid='admin-ws-tab-commands']"),
      ).not.toBeNull();
      expect(container.querySelector("[data-testid='configure-read-only-notice']")).toBeNull();
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
      expect(container.querySelector("[data-testid='admin-http-device-tokens']")).not.toBeNull();

      await openConfigureTab(container, "admin-http-tab-plugins");
      expect(container.querySelector("[data-testid='admin-http-plugins']")).not.toBeNull();

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

  it("requires confirmation before issuing a device token from Configure", async () => {
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
        '[data-testid="admin-http-device-tokens-issue"]',
      );
      expect(issueButton).not.toBeNull();

      act(() => {
        issueButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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

  it("requires confirmation before revoking a device token from Configure", async () => {
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
      const deviceTokensCard = container.querySelector<HTMLElement>(
        '[data-testid="admin-http-device-tokens"]',
      );
      expect(deviceTokensCard).not.toBeNull();

      const tokenInput =
        deviceTokensCard?.querySelector<HTMLInputElement>('input[type="password"]');
      expect(tokenInput).not.toBeNull();

      act(() => {
        setControlledInputValue(tokenInput!, "dev_test_token");
      });

      const revokeButton = container.querySelector<HTMLButtonElement>(
        '[data-testid="admin-http-device-tokens-revoke"]',
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

  it("disables Configure Plugins.get until a plugin id is provided", async () => {
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
      await openConfigureTab(container, "admin-http-tab-plugins");
      const pluginsCard = container.querySelector<HTMLElement>(
        '[data-testid="admin-http-plugins"]',
      );
      expect(pluginsCard).not.toBeNull();

      const buttons = Array.from(pluginsCard?.querySelectorAll<HTMLButtonElement>("button") ?? []);
      const listButton = buttons.find((button) => button.textContent?.trim() === "List");
      expect(listButton).not.toBeUndefined();
      expect(listButton?.disabled).toBe(false);

      const getButton = buttons.find((button) => button.textContent?.trim() === "Get");
      expect(getButton).not.toBeUndefined();
      expect(getButton?.disabled).toBe(true);

      const pluginIdInput = pluginsCard?.querySelector<HTMLInputElement>("input");
      expect(pluginIdInput).not.toBeNull();

      await act(async () => {
        setControlledInputValue(pluginIdInput!, "echo");
        await Promise.resolve();
      });

      expect(pluginIdInput?.value).toBe("echo");

      const nextButtons = Array.from(
        pluginsCard?.querySelectorAll<HTMLButtonElement>("button") ?? [],
      );
      const nextGetButton = nextButtons.find((button) => button.textContent?.trim() === "Get");
      expect(nextGetButton).not.toBeUndefined();
      expect(nextGetButton?.disabled).toBe(false);
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
