import { expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  createBearerTokenAuth,
  createBrowserCookieAuth,
  createOperatorCore,
} from "../../operator-app/src/index.js";
import { OperatorUiApp, OperatorUiHostProvider } from "../src/index.js";
import {
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
  it("auto-opens setup when config health has first-run issues and resumes after skipping", async () => {
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
    expect(container.querySelector('[data-testid="nav-dashboard"]')).toBeNull();
    expect(container.textContent).toContain("Setup steps");
    expect(
      container.querySelector('[data-testid="first-run-onboarding-progress-palette"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="first-run-onboarding-progress-provider"]'),
    ).not.toBeNull();
    expect(
      container
        .querySelector('[data-testid="first-run-onboarding-progress-palette"]')
        ?.getAttribute("data-status"),
    ).toBe("current");
    expect(
      container
        .querySelector('[data-testid="first-run-onboarding-progress-admin"]')
        ?.getAttribute("data-status"),
    ).toBe("upcoming");
    expect(container.textContent).not.toContain("no_provider_accounts:deployment:");

    const skipButton = findButtonByText(container, "Skip for now");
    expect(skipButton).not.toBeNull();
    await act(async () => {
      skipButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const resumeButton = await waitForSelector<HTMLButtonElement>(
      container,
      '[data-testid="dashboard-resume-setup"]',
    );
    expect(container.querySelector('[data-testid="nav-dashboard"]')).not.toBeNull();
    const storedValues = Array.from(local.values());
    expect(storedValues).toHaveLength(1);
    expect(storedValues[0]).toContain('"status":"skipped"');

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

  it("keeps onboarding skipped when the unresolved issue signature changes", async () => {
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
    const skipButton = findButtonByText(container, "Skip for now");
    expect(skipButton).not.toBeNull();
    await act(async () => {
      skipButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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

    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="first-run-onboarding"]')).toBeNull();
    expect(
      await waitForSelector(container, '[data-testid="dashboard-resume-setup"]'),
    ).not.toBeNull();

    cleanup(root, container);
  });

  it("keeps skipped state when config health becomes clean and suppresses the same issue later", async () => {
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
    const skipButton = findButtonByText(container, "Skip for now");
    expect(skipButton).not.toBeNull();
    await act(async () => {
      skipButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(Array.from(local.values())[0]).toContain('"status":"skipped"');

    issues = [];
    await act(async () => {
      await core.syncAllNow();
    });
    expect(local.size).toBe(1);

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

    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="first-run-onboarding"]')).toBeNull();
    expect(
      await waitForSelector(container, '[data-testid="dashboard-resume-setup"]'),
    ).not.toBeNull();

    const resumeButton = findButtonByText(container, "Resume Setup");
    expect(resumeButton).not.toBeNull();
    await act(async () => {
      resumeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(await waitForSelector(container, '[data-testid="first-run-onboarding"]')).not.toBeNull();

    cleanup(root, container);
  });

  it("treats legacy dismissed storage as skipped onboarding", async () => {
    const scopeKey = "desktop:http://example.test:";
    stubPersistentStorage({
      local: new Map<string, string>([
        [
          `tyrum.first-run-onboarding:${scopeKey}`,
          JSON.stringify({
            issueSignature: "no_provider_accounts:deployment:",
            status: "dismissed",
          }),
        ],
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

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="first-run-onboarding"]')).toBeNull();
    expect(
      await waitForSelector(container, '[data-testid="dashboard-resume-setup"]'),
    ).not.toBeNull();

    cleanup(root, container);
  });

}
