// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { createBearerTokenAuth, createOperatorCore } from "../../../operator-core/src/index.js";
import { DesktopEnvironmentsPage } from "../../src/components/pages/desktop-environments-page.js";
import { cleanupTestRoot, click, renderIntoDocument } from "../test-utils.js";
import { FakeWsClient, createFakeHttpClient } from "../operator-ui.test-fixtures.js";

vi.mock("../../src/components/pages/admin-http-shared.js", () => ({
  useAdminHttpClient: () => null,
  useAdminMutationAccess: () => ({
    canMutate: true,
    requestEnter: vi.fn(),
  }),
}));

async function flushPage(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("DesktopEnvironmentsPage", () => {
  it("renders managed hosts and a gateway takeover link", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    const testRoot = renderIntoDocument(React.createElement(DesktopEnvironmentsPage, { core }));
    await flushPage();

    expect(testRoot.container.textContent).toContain("Gateway-managed desktop environments");
    expect(testRoot.container.textContent).toContain("Primary runtime");
    expect(testRoot.container.textContent).toContain("Research desktop");

    const takeoverLink = testRoot.container.querySelector<HTMLAnchorElement>(
      '[data-testid="desktop-environment-takeover-env-1"]',
    );
    expect(takeoverLink?.href).toBe("http://example.test/desktop-environments/env-1/takeover");

    cleanupTestRoot(testRoot);
    core.dispose();
  });

  it("invokes desktop environment create, start, logs, and delete actions", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
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
    await act(async () => {
      click(deleteButton!);
      await Promise.resolve();
    });

    const desktopEnvironmentsApi = http.desktopEnvironments;
    expect(desktopEnvironmentsApi.create).toHaveBeenCalledTimes(1);
    expect(desktopEnvironmentsApi.logs).toHaveBeenCalledTimes(1);
    expect(desktopEnvironmentsApi.start).toHaveBeenCalledTimes(1);
    expect(desktopEnvironmentsApi.remove).toHaveBeenCalledTimes(1);

    cleanupTestRoot(testRoot);
    core.dispose();
  });
});
