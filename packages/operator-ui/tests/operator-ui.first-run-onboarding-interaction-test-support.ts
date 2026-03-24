import { expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createBearerTokenAuth, createOperatorCore } from "../../operator-app/src/index.js";
import { OperatorUiApp } from "../src/index.js";
import {
  TEST_DEVICE_IDENTITY,
  stubPersistentStorage,
  waitForSelector,
} from "./operator-ui.test-support.js";
import { FakeWsClient, createFakeHttpClient } from "./operator-ui.test-fixtures.js";
import {
  advanceOnboardingIntro,
  buildIssueStatusResponse,
  cleanup,
} from "./operator-ui.first-run-onboarding.helpers.js";

export function registerFirstRunOnboardingInteractionTests(): void {
  it("authorizes admin access up front and advances into provider setup", async () => {
    stubPersistentStorage();
    const ws = new FakeWsClient();
    const { http, statusGet, deviceTokensIssue } = createFakeHttpClient();
    statusGet.mockResolvedValue(
      buildIssueStatusResponse([
        {
          code: "no_provider_accounts",
          severity: "error",
          message: "No active provider accounts are configured.",
          target: { kind: "deployment", id: null },
        },
      ]),
    );
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("baseline"),
      deviceIdentity: TEST_DEVICE_IDENTITY,
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
      await Promise.resolve();
    });

    await waitForSelector(container, '[data-testid="first-run-onboarding-step-palette"]');
    expect(
      container.querySelector('[data-testid="first-run-onboarding-progress-palette"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="first-run-onboarding-progress-admin"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="first-run-onboarding-progress-provider"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="first-run-onboarding-progress-preset"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="first-run-onboarding-progress-agent"]'),
    ).not.toBeNull();
    expect(
      container
        .querySelector('[data-testid="first-run-onboarding-progress-palette"]')
        ?.getAttribute("data-status"),
    ).toBe("current");

    await advanceOnboardingIntro(container);

    expect(deviceTokensIssue).toHaveBeenCalledTimes(1);
    expect(
      await waitForSelector(container, '[data-testid="first-run-onboarding-step-provider"]'),
    ).not.toBeNull();
    expect(
      container
        .querySelector('[data-testid="first-run-onboarding-progress-palette"]')
        ?.getAttribute("data-status"),
    ).toBe("done");
    expect(
      container
        .querySelector('[data-testid="first-run-onboarding-progress-admin"]')
        ?.getAttribute("data-status"),
    ).toBe("done");
    expect(
      container
        .querySelector('[data-testid="first-run-onboarding-progress-provider"]')
        ?.getAttribute("data-status"),
    ).toBe("current");

    cleanup(root, container);
  });

  it("lets onboarding choose the theme mode before continuing", async () => {
    const { local } = stubPersistentStorage();
    const ws = new FakeWsClient();
    const { http, statusGet } = createFakeHttpClient();
    statusGet.mockResolvedValue(
      buildIssueStatusResponse([
        {
          code: "no_provider_accounts",
          severity: "error",
          message: "No active provider accounts are configured.",
          target: { kind: "deployment", id: null },
        },
      ]),
    );
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
      await Promise.resolve();
    });

    await waitForSelector(container, '[data-testid="first-run-onboarding-step-palette"]');
    const lightButton = await waitForSelector<HTMLButtonElement>(
      container,
      '[data-testid="first-run-onboarding-theme-light"]',
    );
    await act(async () => {
      lightButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(local.get("tyrum.themeMode")).toBe("light");
    expect(document.documentElement.dataset.themeMode).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");

    const darkButton = await waitForSelector<HTMLButtonElement>(
      container,
      '[data-testid="first-run-onboarding-theme-dark"]',
    );
    await act(async () => {
      darkButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(local.get("tyrum.themeMode")).toBe("dark");
    expect(document.documentElement.dataset.themeMode).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");

    cleanup(root, container);
  });

  it("starts at provider when appearance and admin preferences were already configured", async () => {
    stubPersistentStorage({
      local: new Map<string, string>([
        ["tyrum.themeMode", "light"],
        ["tyrum.colorPalette", "sage"],
        ["tyrum.adminAccessMode", "always-on"],
      ]),
    });
    const ws = new FakeWsClient();
    const { http, statusGet } = createFakeHttpClient();
    statusGet.mockResolvedValue(
      buildIssueStatusResponse([
        {
          code: "no_provider_accounts",
          severity: "error",
          message: "No active provider accounts are configured.",
          target: { kind: "deployment", id: null },
        },
      ]),
    );
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("baseline"),
      deviceIdentity: TEST_DEVICE_IDENTITY,
      deps: { ws, http },
    });
    core.elevatedModeStore.enter({
      elevatedToken: "test-elevated-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
      await Promise.resolve();
    });

    expect(
      await waitForSelector(container, '[data-testid="first-run-onboarding-step-provider"]'),
    ).not.toBeNull();
    expect(
      container
        .querySelector('[data-testid="first-run-onboarding-progress-palette"]')
        ?.getAttribute("data-status"),
    ).toBe("done");
    expect(
      container
        .querySelector('[data-testid="first-run-onboarding-progress-admin"]')
        ?.getAttribute("data-status"),
    ).toBe("done");
    expect(
      container
        .querySelector('[data-testid="first-run-onboarding-progress-provider"]')
        ?.getAttribute("data-status"),
    ).toBe("current");

    cleanup(root, container);
  });

  it("lets users jump between onboarding steps without changing actual progress", async () => {
    stubPersistentStorage();
    const ws = new FakeWsClient();
    const { http, statusGet, deviceTokensIssue } = createFakeHttpClient();
    statusGet.mockResolvedValue(
      buildIssueStatusResponse([
        {
          code: "no_provider_accounts",
          severity: "error",
          message: "No active provider accounts are configured.",
          target: { kind: "deployment", id: null },
        },
      ]),
    );
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("baseline"),
      deviceIdentity: TEST_DEVICE_IDENTITY,
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
      await Promise.resolve();
    });

    await advanceOnboardingIntro(container);
    expect(deviceTokensIssue).toHaveBeenCalledTimes(1);
    expect(
      await waitForSelector(container, '[data-testid="first-run-onboarding-step-provider"]'),
    ).not.toBeNull();

    const presetStep = await waitForSelector<HTMLButtonElement>(
      container,
      '[data-testid="first-run-onboarding-progress-preset"]',
    );
    await act(async () => {
      presetStep.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(
      await waitForSelector(container, '[data-testid="first-run-onboarding-step-preset"]'),
    ).not.toBeNull();
    expect(
      container
        .querySelector('[data-testid="first-run-onboarding-progress-provider"]')
        ?.getAttribute("data-status"),
    ).toBe("current");
    expect(
      container
        .querySelector('[data-testid="first-run-onboarding-progress-preset"]')
        ?.getAttribute("data-status"),
    ).toBe("upcoming");
    expect(
      container
        .querySelector('[data-testid="first-run-onboarding-progress-preset"]')
        ?.getAttribute("data-selected"),
    ).toBe("true");

    const adminStep = await waitForSelector<HTMLButtonElement>(
      container,
      '[data-testid="first-run-onboarding-progress-admin"]',
    );
    await act(async () => {
      adminStep.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(
      await waitForSelector(container, '[data-testid="first-run-onboarding-step-admin"]'),
    ).not.toBeNull();
    expect(
      container
        .querySelector('[data-testid="first-run-onboarding-progress-admin"]')
        ?.getAttribute("data-status"),
    ).toBe("done");
    expect(
      container
        .querySelector('[data-testid="first-run-onboarding-progress-admin"]')
        ?.getAttribute("data-selected"),
    ).toBe("true");
    expect(
      container
        .querySelector('[data-testid="first-run-onboarding-progress-provider"]')
        ?.getAttribute("data-status"),
    ).toBe("current");

    const providerStep = await waitForSelector<HTMLButtonElement>(
      container,
      '[data-testid="first-run-onboarding-progress-provider"]',
    );
    await act(async () => {
      providerStep.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(
      await waitForSelector(container, '[data-testid="first-run-onboarding-step-provider"]'),
    ).not.toBeNull();
    expect(
      container
        .querySelector('[data-testid="first-run-onboarding-progress-provider"]')
        ?.getAttribute("data-selected"),
    ).toBe("true");

    cleanup(root, container);
  });

  it("shows a compact mobile step summary that expands into a selectable list", async () => {
    stubPersistentStorage();
    const ws = new FakeWsClient();
    const { http, statusGet } = createFakeHttpClient();
    statusGet.mockResolvedValue(
      buildIssueStatusResponse([
        {
          code: "no_provider_accounts",
          severity: "error",
          message: "No active provider accounts are configured.",
          target: { kind: "deployment", id: null },
        },
      ]),
    );
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
      await Promise.resolve();
    });

    await waitForSelector(container, '[data-testid="first-run-onboarding-step-palette"]');
    const mobileToggle = await waitForSelector<HTMLButtonElement>(
      container,
      '[data-testid="first-run-onboarding-progress-mobile-toggle"]',
    );
    expect(mobileToggle.getAttribute("aria-expanded")).toBe("false");
    expect(
      container.querySelector('[data-testid="first-run-onboarding-progress-mobile-panel"]'),
    ).toBeNull();

    await act(async () => {
      mobileToggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const mobileAdminStep = await waitForSelector<HTMLButtonElement>(
      container,
      '[data-testid="first-run-onboarding-progress-mobile-admin"]',
    );
    expect(
      await waitForSelector(
        container,
        '[data-testid="first-run-onboarding-progress-mobile-panel"]',
      ),
    ).not.toBeNull();

    await act(async () => {
      mobileAdminStep.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(
      await waitForSelector(container, '[data-testid="first-run-onboarding-step-admin"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="first-run-onboarding-progress-mobile-panel"]'),
    ).toBeNull();
    expect(
      (
        await waitForSelector<HTMLButtonElement>(
          container,
          '[data-testid="first-run-onboarding-progress-mobile-toggle"]',
        )
      ).textContent,
    ).toContain("Choose settings access");

    cleanup(root, container);
  });

  it("keeps the current elevated session when onboarding switches to ask-before-changes", async () => {
    const { local } = stubPersistentStorage({
      local: new Map<string, string>([["tyrum.adminAccessMode", "always-on"]]),
    });
    const ws = new FakeWsClient();
    const { http, statusGet } = createFakeHttpClient();
    statusGet.mockResolvedValue(
      buildIssueStatusResponse([
        {
          code: "no_provider_accounts",
          severity: "error",
          message: "No active provider accounts are configured.",
          target: { kind: "deployment", id: null },
        },
      ]),
    );
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("baseline"),
      deviceIdentity: TEST_DEVICE_IDENTITY,
      deps: { ws, http },
    });
    core.elevatedModeStore.enter({
      elevatedToken: "test-elevated-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
      await Promise.resolve();
    });

    const paletteContinue = await waitForSelector<HTMLButtonElement>(
      container,
      '[data-testid="first-run-onboarding-palette-continue"]',
    );
    await act(async () => {
      paletteContinue.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(
      await waitForSelector(container, '[data-testid="first-run-onboarding-step-provider"]'),
    ).not.toBeNull();

    const adminStepButton = await waitForSelector<HTMLButtonElement>(
      container,
      '[data-testid="first-run-onboarding-progress-admin"]',
    );
    await act(async () => {
      adminStepButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const askBeforeChangesButton = await waitForSelector<HTMLButtonElement>(
      container,
      '[data-testid="first-run-onboarding-admin-mode-on-demand"]',
    );
    await act(async () => {
      askBeforeChangesButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const adminContinue = await waitForSelector<HTMLButtonElement>(
      container,
      '[data-testid="first-run-onboarding-admin-continue"]',
    );
    await act(async () => {
      adminContinue.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(local.get("tyrum.adminAccessMode")).toBe("on-demand");
    expect(core.elevatedModeStore.getSnapshot().status).toBe("active");
    expect(container.textContent).not.toContain("Unable to load onboarding data");
    expect(
      await waitForSelector(container, '[data-testid="first-run-onboarding-step-provider"]'),
    ).not.toBeNull();

    cleanup(root, container);
  });
}
