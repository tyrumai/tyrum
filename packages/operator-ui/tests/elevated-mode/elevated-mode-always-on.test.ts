// @vitest-environment jsdom

import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBearerTokenAuth,
  createOperatorCore,
  type OperatorCore,
} from "../../../operator-app/src/index.js";
import { ElevatedModeProvider } from "../../src/components/elevated-mode/elevated-mode-provider.js";
import { ElevatedModeGate } from "../../src/components/elevated-mode/elevated-mode-gate.js";
import { AdminAccessModeProvider } from "../../src/hooks/use-admin-access-mode.js";
import { FakeWsClient, createFakeHttpClient } from "../operator-ui.test-fixtures.js";
import { TEST_DEVICE_IDENTITY } from "../operator-ui.test-support.js";
import { cleanupTestRoot, type TestRoot } from "../test-utils.js";

const STORAGE_KEY = "tyrum.adminAccessMode";

function createTestCore(ws: FakeWsClient) {
  const { http, deviceTokensIssue, deviceTokensRevoke } = createFakeHttpClient();
  const core = createOperatorCore({
    wsUrl: "ws://example.test/ws",
    httpBaseUrl: "http://example.test",
    auth: createBearerTokenAuth("baseline"),
    deviceIdentity: TEST_DEVICE_IDENTITY,
    deps: { ws, http },
  });
  return { core, deviceTokensIssue, deviceTokensRevoke };
}

function renderWithAlwaysOn(core: OperatorCore, testRoot: TestRoot): void {
  act(() => {
    testRoot.root.render(
      React.createElement(
        AdminAccessModeProvider,
        null,
        React.createElement(
          ElevatedModeProvider,
          { core, mode: "web" },
          React.createElement(
            ElevatedModeGate,
            null,
            React.createElement("div", { "data-testid": "protected-content" }, "Protected"),
          ),
        ),
      ),
    );
  });
}

describe("elevated mode always-on", () => {
  let testRoot: TestRoot | null = null;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    if (testRoot) {
      cleanupTestRoot(testRoot);
      testRoot = null;
    }
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("auto-enters elevated mode when always-on and connected", async () => {
    localStorage.setItem(STORAGE_KEY, "always-on");

    const ws = new FakeWsClient();
    const { core, deviceTokensIssue } = createTestCore(ws);
    act(() => {
      core.connect();
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const { createRoot } = await import("react-dom/client");
    let root: ReturnType<typeof createRoot>;
    act(() => {
      root = createRoot(container);
    });
    testRoot = { container, root: root! };

    await act(async () => {
      renderWithAlwaysOn(core, testRoot!);
      await Promise.resolve();
    });

    // Give the auto-enter effect time to fire
    await act(async () => {
      await Promise.resolve();
    });

    expect(deviceTokensIssue).toHaveBeenCalledTimes(1);
    expect(core.elevatedModeStore.getSnapshot().status).toBe("active");
  });

  it("does not auto-enter when on-demand", async () => {
    localStorage.setItem(STORAGE_KEY, "on-demand");

    const ws = new FakeWsClient();
    const { core, deviceTokensIssue } = createTestCore(ws);
    act(() => {
      core.connect();
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const { createRoot } = await import("react-dom/client");
    let root: ReturnType<typeof createRoot>;
    act(() => {
      root = createRoot(container);
    });
    testRoot = { container, root: root! };

    await act(async () => {
      renderWithAlwaysOn(core, testRoot!);
      await Promise.resolve();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(deviceTokensIssue).not.toHaveBeenCalled();
    expect(core.elevatedModeStore.getSnapshot().status).toBe("inactive");
  });

  it("does not auto-enter when not connected", async () => {
    localStorage.setItem(STORAGE_KEY, "always-on");

    const ws = new FakeWsClient(false);
    const { core, deviceTokensIssue } = createTestCore(ws);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const { createRoot } = await import("react-dom/client");
    let root: ReturnType<typeof createRoot>;
    act(() => {
      root = createRoot(container);
    });
    testRoot = { container, root: root! };

    await act(async () => {
      renderWithAlwaysOn(core, testRoot!);
      await Promise.resolve();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(deviceTokensIssue).not.toHaveBeenCalled();
    expect(core.elevatedModeStore.getSnapshot().status).toBe("inactive");
  });

  it("falls back silently when auto-enter fails", async () => {
    localStorage.setItem(STORAGE_KEY, "always-on");

    const ws = new FakeWsClient();
    const { core, deviceTokensIssue } = createTestCore(ws);
    deviceTokensIssue.mockRejectedValueOnce(new Error("token issue failed"));
    act(() => {
      core.connect();
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const { createRoot } = await import("react-dom/client");
    let root: ReturnType<typeof createRoot>;
    act(() => {
      root = createRoot(container);
    });
    testRoot = { container, root: root! };

    await act(async () => {
      renderWithAlwaysOn(core, testRoot!);
      await Promise.resolve();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(deviceTokensIssue).toHaveBeenCalledTimes(1);
    expect(core.elevatedModeStore.getSnapshot().status).toBe("inactive");

    // Should show the gate card instead
    expect(testRoot!.container.querySelector('[data-testid="elevated-mode-enter"]')).not.toBeNull();
  });
});
