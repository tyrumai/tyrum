// @vitest-environment jsdom

import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBearerTokenAuth,
  createOperatorCore,
  type OperatorCore,
} from "../../../operator-app/src/index.js";
import type { ElevatedModeController } from "../../src/components/elevated-mode/elevated-mode-controller.js";
import {
  ElevatedModeProvider,
  useElevatedModeUiContext,
} from "../../src/components/elevated-mode/elevated-mode-provider.js";
import { ElevatedModeGate } from "../../src/components/elevated-mode/elevated-mode-gate.js";
import {
  AdminAccessModeProvider,
  useAdminAccessMode,
} from "../../src/hooks/use-admin-access-mode.js";
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

function AdminAccessModeSwitchButton({
  preserveElevatedConversation = false,
}: {
  preserveElevatedConversation?: boolean;
}) {
  const { setMode } = useAdminAccessMode();
  return React.createElement(
    "button",
    {
      "data-testid": "switch-on-demand",
      onClick: () => {
        setMode("on-demand", { preserveElevatedConversation });
      },
    },
    "Switch to on-demand",
  );
}

function ExitHandlerIdentityProbe() {
  const { exitElevatedMode } = useElevatedModeUiContext();
  const { setMode } = useAdminAccessMode();
  const initialHandlerRef = React.useRef<typeof exitElevatedMode | null>(null);
  const changedRef = React.useRef(false);

  if (initialHandlerRef.current === null) {
    initialHandlerRef.current = exitElevatedMode;
  } else if (initialHandlerRef.current !== exitElevatedMode) {
    changedRef.current = true;
  }

  return React.createElement(
    "div",
    null,
    React.createElement("div", {
      "data-testid": "exit-handler-changed",
      "data-value": String(changedRef.current),
    }),
    React.createElement(
      "button",
      {
        "data-testid": "switch-always-on",
        onClick: () => {
          setMode("always-on");
        },
      },
      "Switch to always-on",
    ),
    React.createElement(
      "button",
      {
        "data-testid": "switch-on-demand",
        onClick: () => {
          setMode("on-demand");
        },
      },
      "Switch to on-demand",
    ),
  );
}

function renderWithAdminAccessModeControl(
  core: OperatorCore,
  testRoot: TestRoot,
  options?: {
    preserveElevatedConversation?: boolean;
    controller?: ElevatedModeController;
  },
): void {
  act(() => {
    testRoot.root.render(
      React.createElement(
        AdminAccessModeProvider,
        null,
        React.createElement(
          ElevatedModeProvider,
          { core, mode: "web", adminAccessController: options?.controller },
          React.createElement(AdminAccessModeSwitchButton, {
            preserveElevatedConversation: options?.preserveElevatedConversation,
          }),
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

  it("exits elevated mode when switching from always-on to on-demand", async () => {
    localStorage.setItem(STORAGE_KEY, "always-on");

    const ws = new FakeWsClient();
    const { core } = createTestCore(ws);
    core.elevatedModeStore.enter({
      elevatedToken: "test-elevated-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
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
      renderWithAdminAccessModeControl(core, testRoot!);
      await Promise.resolve();
    });

    const switchButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="switch-on-demand"]',
    );
    expect(switchButton).not.toBeNull();

    await act(async () => {
      switchButton?.click();
      await Promise.resolve();
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBe("on-demand");
    expect(core.elevatedModeStore.getSnapshot().status).toBe("inactive");
  });

  it("preserves elevated mode when the downgrade opts in during onboarding-style flows", async () => {
    localStorage.setItem(STORAGE_KEY, "always-on");

    const ws = new FakeWsClient();
    const { core } = createTestCore(ws);
    core.elevatedModeStore.enter({
      elevatedToken: "test-elevated-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
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
      renderWithAdminAccessModeControl(core, testRoot!, {
        preserveElevatedConversation: true,
      });
      await Promise.resolve();
    });

    const switchButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="switch-on-demand"]',
    );
    expect(switchButton).not.toBeNull();

    await act(async () => {
      switchButton?.click();
      await Promise.resolve();
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBe("on-demand");
    expect(core.elevatedModeStore.getSnapshot().status).toBe("active");
  });

  it("forces a local exit when controller-backed downgrade revocation fails", async () => {
    localStorage.setItem(STORAGE_KEY, "always-on");

    const ws = new FakeWsClient();
    const { core } = createTestCore(ws);
    core.elevatedModeStore.enter({
      elevatedToken: "test-elevated-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    const controller: ElevatedModeController = {
      enter: vi.fn(async () => {}),
      exit: vi.fn(async () => {
        throw new Error("revoke failed");
      }),
    };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const { createRoot } = await import("react-dom/client");
    let root: ReturnType<typeof createRoot>;
    act(() => {
      root = createRoot(container);
    });
    testRoot = { container, root: root! };

    await act(async () => {
      renderWithAdminAccessModeControl(core, testRoot!, { controller });
      await Promise.resolve();
    });

    const switchButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="switch-on-demand"]',
    );
    expect(switchButton).not.toBeNull();

    await act(async () => {
      switchButton?.click();
      await Promise.resolve();
    });

    expect(controller.exit).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("on-demand");
    expect(core.elevatedModeStore.getSnapshot().status).toBe("inactive");
  });

  it("keeps the exit handler stable across provider rerenders", async () => {
    localStorage.setItem(STORAGE_KEY, "on-demand");

    const ws = new FakeWsClient(false);
    const { core } = createTestCore(ws);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const { createRoot } = await import("react-dom/client");
    let root: ReturnType<typeof createRoot>;
    act(() => {
      root = createRoot(container);
    });
    testRoot = { container, root: root! };

    act(() => {
      testRoot!.root.render(
        React.createElement(
          AdminAccessModeProvider,
          null,
          React.createElement(
            ElevatedModeProvider,
            { core, mode: "web" },
            React.createElement(ExitHandlerIdentityProbe),
          ),
        ),
      );
    });

    const switchAlwaysOnButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="switch-always-on"]',
    );
    expect(switchAlwaysOnButton).not.toBeNull();

    act(() => {
      switchAlwaysOnButton?.click();
    });

    const switchOnDemandButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="switch-on-demand"]',
    );
    expect(switchOnDemandButton).not.toBeNull();

    act(() => {
      switchOnDemandButton?.click();
    });

    const changedEl = testRoot.container.querySelector('[data-testid="exit-handler-changed"]');
    expect(changedEl?.getAttribute("data-value")).toBe("false");
  });
});
