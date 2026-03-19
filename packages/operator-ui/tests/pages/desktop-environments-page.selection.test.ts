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
    AdminAccessGateCard: () =>
      ReactModule.createElement("div", { "data-testid": "admin-access-gate" }),
    AdminMutationGate: ({ children }: { children?: React.ReactNode }) =>
      canMutate
        ? ReactModule.createElement(ReactModule.Fragment, null, children)
        : ReactModule.createElement("div", { "data-testid": "admin-access-gate" }),
  };
});

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

describe("DesktopEnvironmentsPage selection", () => {
  it("keeps the newly created environment selected after refresh completes", async () => {
    let resolveRefresh:
      | ((value: {
          status: "ok";
          environments: readonly ReturnType<typeof createEnvironment>[];
        }) => void)
      | null = null;

    const ws = new FakeWsClient(false);
    const { http } = createFakeHttpClient();
    adminHttpClient = http;

    http.desktopEnvironments.list
      .mockResolvedValueOnce({
        status: "ok",
        environments: [createEnvironment()],
      })
      .mockImplementationOnce(
        async () =>
          await new Promise((resolve) => {
            resolveRefresh = resolve;
          }),
      );
    http.desktopEnvironments.create.mockResolvedValueOnce({
      status: "ok",
      environment: createEnvironment({
        environment_id: "env-2",
        label: "New desktop",
        node_id: "node-desktop-2",
        takeover_url: "http://127.0.0.1:8788/desktop-environments/env-2/takeover",
      }),
    });

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
      await Promise.resolve();
    });

    expect(resolveRefresh).not.toBeNull();
    await act(async () => {
      resolveRefresh?.({
        status: "ok",
        environments: [
          createEnvironment(),
          createEnvironment({
            environment_id: "env-2",
            label: "New desktop",
            node_id: "node-desktop-2",
            takeover_url: "http://127.0.0.1:8788/desktop-environments/env-2/takeover",
          }),
        ],
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitForAssertion(() => {
      expect(
        testRoot.container.querySelector('[data-testid="desktop-environment-logs-button-env-2"]'),
      ).not.toBeNull();
      expect(
        testRoot.container.querySelector('[data-testid="desktop-environment-logs-button-env-1"]'),
      ).toBeNull();
    });

    cleanupTestRoot(testRoot);
    core.dispose();
  });
});
