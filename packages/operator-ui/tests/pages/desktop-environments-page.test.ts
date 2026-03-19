// @vitest-environment jsdom

import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TyrumHttpClientError } from "@tyrum/operator-core/browser";
import { createBearerTokenAuth, createOperatorCore } from "../../../operator-core/src/index.js";
import { DesktopEnvironmentsPage } from "../../src/components/pages/desktop-environments-page.js";
import { cleanupTestRoot, click, renderIntoDocument } from "../test-utils.js";
import { FakeWsClient, createFakeHttpClient } from "../operator-ui.test-fixtures.js";

let adminHttpClient: ReturnType<typeof createFakeHttpClient>["http"] | null = null;
let canMutate = true;
const requestEnter = vi.fn();

vi.mock("../../src/components/pages/admin-http-shared.js", async () => {
  const ReactModule = await import("react");

  return {
    useAdminHttpClient: () => adminHttpClient,
    useAdminMutationAccess: () => ({
      canMutate,
      requestEnter,
    }),
    isAdminAccessHttpError: (error: unknown) =>
      error instanceof TyrumHttpClientError &&
      error.status === 403 &&
      error.error === "forbidden" &&
      error.message === "insufficient scope",
    AdminAccessGateCard: ({
      title = "Authorize admin access to continue",
      description = "Admin access required.",
    }: {
      title?: string;
      description?: string;
    }) =>
      ReactModule.createElement(
        "div",
        { "data-testid": "admin-access-gate" },
        ReactModule.createElement("div", null, title),
        ReactModule.createElement("div", null, description),
        ReactModule.createElement(
          "button",
          {
            type: "button",
            "data-testid": "admin-access-enter",
            onClick: () => {
              requestEnter();
            },
          },
          "Authorize admin access",
        ),
      ),
    AdminMutationGate: ({
      children,
      title = "Authorize admin access to continue",
      description = "Admin access required.",
    }: {
      children?: React.ReactNode;
      title?: string;
      description?: string;
    }) =>
      canMutate
        ? ReactModule.createElement(ReactModule.Fragment, null, children)
        : ReactModule.createElement(
            "div",
            { "data-testid": "admin-access-gate" },
            ReactModule.createElement("div", null, title),
            ReactModule.createElement("div", null, description),
            ReactModule.createElement(
              "button",
              {
                type: "button",
                "data-testid": "admin-access-enter",
                onClick: () => {
                  requestEnter();
                },
              },
              "Authorize admin access",
            ),
          ),
  };
});

async function flushPage(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function waitForAssertion(assertion: () => void, attempts = 8): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await flushPage();
    }
  }
  throw lastError;
}

function createEnvironment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    environment_id: "env-1",
    host_id: "host-1",
    label: "Research desktop",
    image_ref: "registry.example.test/desktop@sha256:1234",
    managed_kind: "docker",
    status: "running",
    desired_running: true,
    node_id: "node-desktop-1",
    takeover_url: "http://127.0.0.1:8788/desktop-environments/env-1/takeover",
    last_seen_at: "2026-03-10T12:00:00.000Z",
    last_error: null,
    created_at: "2026-03-10T12:00:00.000Z",
    updated_at: "2026-03-10T12:00:00.000Z",
    ...overrides,
  } as const;
}

beforeEach(() => {
  adminHttpClient = null;
  canMutate = true;
  requestEnter.mockReset();
});

afterEach(() => {
  adminHttpClient = null;
  canMutate = true;
  requestEnter.mockReset();
});

describe("DesktopEnvironmentsPage", () => {
  it("prompts for admin access before loading desktop environments", async () => {
    canMutate = false;

    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });
    const hostListCallsBeforeRender = http.desktopEnvironmentHosts.list.mock.calls.length;
    const environmentListCallsBeforeRender = http.desktopEnvironments.list.mock.calls.length;
    const testRoot = renderIntoDocument(
      React.createElement(DesktopEnvironmentsPage, { core, mode: "web" }),
    );
    await flushPage();

    expect(testRoot.container.textContent).toContain(
      "Authorize admin access to load desktop environments",
    );
    expect(http.desktopEnvironmentHosts.list.mock.calls.length).toBeGreaterThanOrEqual(
      hostListCallsBeforeRender,
    );
    expect(http.desktopEnvironments.list.mock.calls.length).toBeGreaterThanOrEqual(
      environmentListCallsBeforeRender,
    );

    const enterButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-access-enter"]',
    );
    expect(enterButton).not.toBeNull();
    await act(async () => {
      click(enterButton!);
    });
    expect(requestEnter).toHaveBeenCalledTimes(1);

    cleanupTestRoot(testRoot);
    core.dispose();
  });

  it("falls back to the admin access gate when a desktop inventory load loses admin scope", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    adminHttpClient = http;
    const forbiddenError = new TyrumHttpClientError("http_error", "insufficient scope", {
      status: 403,
      error: "forbidden",
    });
    http.desktopEnvironmentHosts.list.mockImplementation(async () => {
      adminHttpClient = null;
      canMutate = false;
      throw forbiddenError;
    });
    http.desktopEnvironments.list.mockImplementation(async () => {
      adminHttpClient = null;
      canMutate = false;
      throw forbiddenError;
    });

    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });
    const testRoot = renderIntoDocument(React.createElement(DesktopEnvironmentsPage, { core }));
    await waitForAssertion(() => {
      expect(testRoot.container.querySelector("[data-testid='admin-access-gate']")).not.toBeNull();
    });

    expect(testRoot.container.textContent).toContain(
      "Authorize admin access to load desktop environments",
    );
    expect(testRoot.container.textContent).not.toContain("insufficient scope");

    cleanupTestRoot(testRoot);
    core.dispose();
  });

  it("keeps the admin access gate visible when one desktop inventory request loses scope", async () => {
    let resolveEnvironments:
      | ((value: {
          status: "ok";
          environments: readonly ReturnType<typeof createEnvironment>[];
        }) => void)
      | null = null;

    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    adminHttpClient = http;
    const forbiddenError = new TyrumHttpClientError("http_error", "insufficient scope", {
      status: 403,
      error: "forbidden",
    });
    http.desktopEnvironmentHosts.list.mockImplementation(async () => {
      adminHttpClient = null;
      canMutate = false;
      throw forbiddenError;
    });
    http.desktopEnvironments.list.mockImplementation(
      async () =>
        await new Promise((resolve) => {
          resolveEnvironments = resolve;
        }),
    );

    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });
    const testRoot = renderIntoDocument(React.createElement(DesktopEnvironmentsPage, { core }));

    await waitForAssertion(() => {
      expect(http.desktopEnvironmentHosts.list).toHaveBeenCalledTimes(1);
      expect(http.desktopEnvironments.list).toHaveBeenCalledTimes(1);
      expect(resolveEnvironments).not.toBeNull();
    });

    await act(async () => {
      resolveEnvironments?.({
        status: "ok",
        environments: [createEnvironment()],
      });
      await Promise.resolve();
    });

    await waitForAssertion(() => {
      expect(testRoot.container.querySelector("[data-testid='admin-access-gate']")).not.toBeNull();
    });
    expect(testRoot.container.textContent).toContain(
      "Authorize admin access to load desktop environments",
    );
    expect(testRoot.container.textContent).not.toContain("insufficient scope");

    cleanupTestRoot(testRoot);
    core.dispose();
  });

  it("reloads desktop inventory only once when admin access is re-granted", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    adminHttpClient = http;
    const forbiddenError = new TyrumHttpClientError("http_error", "insufficient scope", {
      status: 403,
      error: "forbidden",
    });

    http.desktopEnvironmentHosts.list
      .mockImplementationOnce(async () => {
        adminHttpClient = null;
        throw forbiddenError;
      })
      .mockResolvedValue({
        status: "ok",
        hosts: [
          {
            host_id: "host-1",
            label: "Primary runtime",
            version: "0.1.0",
            docker_available: true,
            healthy: true,
            last_seen_at: "2026-03-10T12:00:00.000Z",
            last_error: null,
          },
        ],
      });
    http.desktopEnvironments.list
      .mockImplementationOnce(async () => {
        adminHttpClient = null;
        throw forbiddenError;
      })
      .mockResolvedValue({
        status: "ok",
        environments: [createEnvironment()],
      });

    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });
    const testRoot = renderIntoDocument(React.createElement(DesktopEnvironmentsPage, { core }));

    await waitForAssertion(() => {
      expect(http.desktopEnvironmentHosts.list).toHaveBeenCalledTimes(1);
      expect(http.desktopEnvironments.list).toHaveBeenCalledTimes(1);
    });

    adminHttpClient = http;
    canMutate = true;
    await act(async () => {
      testRoot.root.render(React.createElement(DesktopEnvironmentsPage, { core }));
      await Promise.resolve();
    });
    await waitForAssertion(() => {
      expect(testRoot.container.textContent).toContain("Research desktop");
    });

    expect(http.desktopEnvironmentHosts.list).toHaveBeenCalledTimes(2);
    expect(http.desktopEnvironments.list).toHaveBeenCalledTimes(2);

    cleanupTestRoot(testRoot);
    core.dispose();
  });

  it("renders the gateway takeover link in same-origin web mode", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    adminHttpClient = http;
    const httpBaseUrl = window.location.origin;

    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl,
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });
    const hostListCallsBeforeRender = http.desktopEnvironmentHosts.list.mock.calls.length;
    const environmentListCallsBeforeRender = http.desktopEnvironments.list.mock.calls.length;
    const testRoot = renderIntoDocument(
      React.createElement(DesktopEnvironmentsPage, { core, mode: "web" }),
    );
    await flushPage();

    expect(testRoot.container.textContent).toContain("Gateway-managed desktop environments");
    expect(testRoot.container.textContent).toContain("Primary runtime");
    expect(testRoot.container.textContent).toContain("Research desktop");
    expect(http.desktopEnvironmentHosts.list.mock.calls.length).toBeGreaterThanOrEqual(
      hostListCallsBeforeRender + 1,
    );
    expect(http.desktopEnvironments.list.mock.calls.length).toBeGreaterThanOrEqual(
      environmentListCallsBeforeRender + 1,
    );

    const takeoverLink = testRoot.container.querySelector<HTMLAnchorElement>(
      '[data-testid="desktop-environment-takeover-env-1"]',
    );
    expect(takeoverLink?.href).toBe(`${httpBaseUrl}/desktop-environments/env-1/takeover`);
    expect(http.desktopEnvironments.takeoverUrl).not.toHaveBeenCalled();

    cleanupTestRoot(testRoot);
    core.dispose();
  });

  it("resolves a trusted takeover URL before opening takeover in cross-origin web mode", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    adminHttpClient = http;
    const openSpy = vi.spyOn(window, "open").mockReturnValue({} as Window);

    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });
    const testRoot = renderIntoDocument(
      React.createElement(DesktopEnvironmentsPage, { core, mode: "web" }),
    );
    await flushPage();

    const takeoverButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="desktop-environment-takeover-env-1"]',
    );
    expect(takeoverButton).not.toBeNull();

    await act(async () => {
      click(takeoverButton!);
      await Promise.resolve();
    });

    expect(http.desktopEnvironments.takeoverUrl).toHaveBeenCalledWith("env-1");
    expect(openSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:6080/vnc.html?autoconnect=true",
      "_blank",
      "noopener,noreferrer",
    );

    cleanupTestRoot(testRoot);
    core.dispose();
  });

  it("invokes desktop environment create, start, logs, and delete actions via admin http", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    adminHttpClient = http;

    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });
    const testRoot = renderIntoDocument(React.createElement(DesktopEnvironmentsPage, { core }));
    await flushPage();

    const createButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="desktop-environments-create-button"]',
    );
    expect(createButton).not.toBeNull();
    await act(async () => {
      click(createButton!);
      await Promise.resolve();
    });

    const logsButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="desktop-environment-logs-button-env-1"]',
    );
    expect(logsButton).not.toBeNull();
    await act(async () => {
      click(logsButton!);
      await Promise.resolve();
    });

    const startButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="desktop-environment-start-env-1"]',
    );
    expect(startButton).not.toBeNull();
    await act(async () => {
      click(startButton!);
      await Promise.resolve();
    });

    const deleteButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="desktop-environment-delete-env-1"]',
    );
    expect(deleteButton).not.toBeNull();
    const listCallsBeforeDelete = http.desktopEnvironments.list.mock.calls.length;
    await act(async () => {
      click(deleteButton!);
      await Promise.resolve();
    });

    const desktopEnvironmentsApi = http.desktopEnvironments;
    expect(desktopEnvironmentsApi.create).toHaveBeenCalledTimes(1);
    expect(desktopEnvironmentsApi.create).toHaveBeenCalledWith({
      host_id: "host-1",
      label: undefined,
      image_ref: "ghcr.io/rhernaus/tyrum-desktop-sandbox:stable",
      desired_running: false,
    });
    expect(desktopEnvironmentsApi.logs).toHaveBeenCalledTimes(1);
    expect(desktopEnvironmentsApi.start).toHaveBeenCalledTimes(1);
    expect(desktopEnvironmentsApi.remove).toHaveBeenCalledTimes(1);
    expect(http.desktopEnvironments.list).toHaveBeenCalledTimes(listCallsBeforeDelete + 1);

    cleanupTestRoot(testRoot);
    core.dispose();
  });
});
