import { expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  createBearerTokenAuth,
  createBrowserCookieAuth,
  createOperatorCore,
} from "../../operator-core/src/index.js";
import { OperatorUiApp, OperatorUiHostProvider } from "../src/index.js";
import {
  TEST_DEVICE_IDENTITY,
  stubPersistentStorage,
  waitForSelector,
} from "./operator-ui.test-support.js";
import {
  FakeWsClient,
  createFakeHttpClient,
  sampleStatusResponse,
} from "./operator-ui.test-fixtures.js";
import {
  buildIssueStatusResponse,
  cleanup,
  createMobileHostApi,
  findButtonByText,
} from "./operator-ui.first-run-onboarding.helpers.js";

export function registerFirstRunOnboardingStateTests(): void {
  it("auto-opens setup when config health has first-run issues and resumes after dismissal", async () => {
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

    await waitForSelector(container, '[data-testid="first-run-onboarding"]');

    const dismissButton = findButtonByText(container, "Dismiss");
    expect(dismissButton).not.toBeNull();
    await act(async () => {
      dismissButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const resumeButton = await waitForSelector<HTMLButtonElement>(
      container,
      '[data-testid="dashboard-resume-setup"]',
    );
    const storedValues = Array.from(local.values());
    expect(storedValues).toHaveLength(1);
    expect(storedValues[0]).toContain('"status":"dismissed"');

    await act(async () => {
      resumeButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(await waitForSelector(container, '[data-testid="first-run-onboarding"]')).not.toBeNull();

    cleanup(root, container);
  });

  it("keeps web users on the connect page while disconnected", () => {
    stubPersistentStorage();
    const ws = new FakeWsClient(false);
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
      auth: createBrowserCookieAuth(),
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "web" }));
    });

    expect(container.querySelector('[data-testid="login-button"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="first-run-onboarding"]')).toBeNull();

    cleanup(root, container);
  });

  it("keeps desktop users on the connect page while disconnected", () => {
    stubPersistentStorage();
    const ws = new FakeWsClient(false);
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
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
    });

    expect(container.querySelector('[data-testid="login-button"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="first-run-onboarding"]')).toBeNull();

    cleanup(root, container);
  });

  it("does not auto-open onboarding on the mobile host", async () => {
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
      root.render(
        React.createElement(
          OperatorUiHostProvider,
          { value: { kind: "mobile", api: createMobileHostApi() } },
          React.createElement(OperatorUiApp, { core, mode: "web" }),
        ),
      );
      await Promise.resolve();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="first-run-onboarding"]')).toBeNull();

    cleanup(root, container);
  });

  it("reopens onboarding when the unresolved issue signature changes after dismissal", async () => {
    stubPersistentStorage();
    let issues: Parameters<typeof buildIssueStatusResponse>[0] = [
      {
        code: "no_provider_accounts",
        severity: "error",
        message: "No active provider accounts are configured.",
        target: { kind: "deployment", id: null },
      },
    ];
    const ws = new FakeWsClient();
    const { http, statusGet } = createFakeHttpClient();
    statusGet.mockImplementation(async () => buildIssueStatusResponse(issues));
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

    await waitForSelector(container, '[data-testid="first-run-onboarding"]');
    const dismissButton = findButtonByText(container, "Dismiss");
    expect(dismissButton).not.toBeNull();
    await act(async () => {
      dismissButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    issues = [
      {
        code: "agent_model_unconfigured",
        severity: "error",
        message: "Agent 'default' has no primary model configured.",
        target: { kind: "agent", id: "default" },
      },
    ];
    await act(async () => {
      await core.syncAllNow();
    });

    expect(await waitForSelector(container, '[data-testid="first-run-onboarding"]')).not.toBeNull();

    cleanup(root, container);
  });

  it("clears dismissed state once config health becomes clean and reopens for the same issue later", async () => {
    const { local } = stubPersistentStorage();
    let issues: Parameters<typeof buildIssueStatusResponse>[0] = [
      {
        code: "no_provider_accounts",
        severity: "error",
        message: "No active provider accounts are configured.",
        target: { kind: "deployment", id: null },
      },
    ];
    const ws = new FakeWsClient();
    const { http, statusGet } = createFakeHttpClient();
    statusGet.mockImplementation(async () =>
      issues.length === 0 ? sampleStatusResponse() : buildIssueStatusResponse(issues),
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

    await waitForSelector(container, '[data-testid="first-run-onboarding"]');
    const dismissButton = findButtonByText(container, "Dismiss");
    expect(dismissButton).not.toBeNull();
    await act(async () => {
      dismissButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(Array.from(local.values())[0]).toContain('"status":"dismissed"');

    issues = [];
    await act(async () => {
      await core.syncAllNow();
    });
    expect(local.size).toBe(0);

    issues = [
      {
        code: "no_provider_accounts",
        severity: "error",
        message: "No active provider accounts are configured.",
        target: { kind: "deployment", id: null },
      },
    ];
    await act(async () => {
      await core.syncAllNow();
    });

    expect(await waitForSelector(container, '[data-testid="first-run-onboarding"]')).not.toBeNull();

    cleanup(root, container);
  });

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

    await waitForSelector(container, '[data-testid="first-run-onboarding-step-admin"]');
    const authorizeButton = findButtonByText(container, "Authorize admin access");
    expect(authorizeButton).not.toBeNull();
    await act(async () => {
      authorizeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(deviceTokensIssue).toHaveBeenCalledTimes(1);
    expect(
      await waitForSelector(container, '[data-testid="first-run-onboarding-step-provider"]'),
    ).not.toBeNull();

    cleanup(root, container);
  });
}
