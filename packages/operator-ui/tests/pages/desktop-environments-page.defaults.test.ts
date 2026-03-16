// @vitest-environment jsdom

import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DESKTOP_ENVIRONMENT_IMAGE_REF } from "@tyrum/schemas";
import { TyrumHttpClientError } from "@tyrum/client/browser";
import { createBearerTokenAuth, createOperatorCore } from "../../../operator-core/src/index.js";
import { DesktopEnvironmentsPage } from "../../src/components/pages/desktop-environments-page.js";
import { cleanupTestRoot, click, renderIntoDocument, setNativeValue } from "../test-utils.js";
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

describe("DesktopEnvironmentsPage defaults and availability", () => {
  it("blocks create and start when no Docker-capable host is available", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    adminHttpClient = http;

    http.desktopEnvironmentHosts.list.mockResolvedValue({
      status: "ok",
      hosts: [
        {
          host_id: "host-1",
          label: "Primary runtime",
          version: "0.1.0",
          docker_available: false,
          healthy: true,
          last_seen_at: "2026-03-10T12:00:00.000Z",
          last_error: "Cannot connect to the Docker daemon",
        },
      ],
    });

    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });
    const testRoot = renderIntoDocument(React.createElement(DesktopEnvironmentsPage, { core }));
    await flushPage();

    expect(testRoot.container.textContent).toContain("Desktop environment mutations are blocked");
    expect(testRoot.container.textContent).toContain("Cannot connect to the Docker daemon");

    const createButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="desktop-environments-create-button"]',
    );
    const startButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="desktop-environment-start-env-1"]',
    );

    expect(createButton?.disabled).toBe(true);
    expect(startButton?.disabled).toBe(true);

    cleanupTestRoot(testRoot);
    core.dispose();
  });

  it("saves runtime defaults and uses the saved default for create", async () => {
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

    const defaultImageInput = testRoot.container.querySelector<HTMLInputElement>(
      '[data-testid="desktop-environments-default-image-input"]',
    );
    const saveButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="desktop-environments-default-image-save-button"]',
    );
    const createButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="desktop-environments-create-button"]',
    );

    expect(defaultImageInput).not.toBeNull();
    expect(saveButton).not.toBeNull();
    expect(createButton).not.toBeNull();

    await act(async () => {
      setNativeValue(defaultImageInput!, "ghcr.io/rhernaus/tyrum-desktop-sandbox:sha-1234");
      click(saveButton!);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      click(createButton!);
      await Promise.resolve();
    });

    expect(http.desktopEnvironments.updateDefaults).toHaveBeenCalledWith({
      default_image_ref: "ghcr.io/rhernaus/tyrum-desktop-sandbox:sha-1234",
      reason: undefined,
    });
    expect(http.desktopEnvironments.create).toHaveBeenLastCalledWith({
      host_id: "host-1",
      label: undefined,
      image_ref: "ghcr.io/rhernaus/tyrum-desktop-sandbox:sha-1234",
      desired_running: false,
    });

    cleanupTestRoot(testRoot);
    core.dispose();
  });

  it("shows save errors when updating runtime defaults fails", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    adminHttpClient = http;

    http.desktopEnvironments.updateDefaults.mockRejectedValueOnce(
      new TyrumHttpClientError("http_error", "save failed", {
        status: 500,
        error: "internal_error",
      }),
    );

    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });
    const testRoot = renderIntoDocument(React.createElement(DesktopEnvironmentsPage, { core }));
    await flushPage();

    const defaultImageInput = testRoot.container.querySelector<HTMLInputElement>(
      '[data-testid="desktop-environments-default-image-input"]',
    );
    const saveButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="desktop-environments-default-image-save-button"]',
    );

    expect(defaultImageInput).not.toBeNull();
    expect(saveButton).not.toBeNull();

    await act(async () => {
      setNativeValue(defaultImageInput!, "ghcr.io/rhernaus/tyrum-desktop-sandbox:broken");
      click(saveButton!);
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushPage();

    expect(testRoot.container.textContent).toContain("Failed to save runtime defaults");
    expect(testRoot.container.textContent).toContain("save failed");

    cleanupTestRoot(testRoot);
    core.dispose();
  });

  it("falls back to the built-in default when the defaults API is unavailable", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    adminHttpClient = http;

    http.desktopEnvironments.getDefaults.mockRejectedValueOnce(
      new TyrumHttpClientError("http_error", "not found", {
        status: 404,
        error: "not_found",
      }),
    );

    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });
    const testRoot = renderIntoDocument(React.createElement(DesktopEnvironmentsPage, { core }));
    await flushPage();

    expect(testRoot.container.textContent).toContain(
      "Runtime defaults are not available on this gateway",
    );

    const createButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="desktop-environments-create-button"]',
    );
    expect(createButton).not.toBeNull();

    await act(async () => {
      click(createButton!);
      await Promise.resolve();
    });

    expect(http.desktopEnvironments.create).toHaveBeenCalledWith({
      host_id: "host-1",
      label: undefined,
      image_ref: DEFAULT_DESKTOP_ENVIRONMENT_IMAGE_REF,
      desired_running: false,
    });

    cleanupTestRoot(testRoot);
    core.dispose();
  });
});
