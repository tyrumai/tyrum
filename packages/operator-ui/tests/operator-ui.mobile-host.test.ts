// @vitest-environment jsdom

import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { createBearerTokenAuth, createOperatorCore } from "../../operator-app/src/index.js";
import { OperatorUiApp } from "../src/app.js";
import {
  OperatorUiHostProvider,
  type MobileHostApi,
  type MobileHostState,
  type OperatorUiHostApi,
} from "../src/host/host-api.js";
import { FakeWsClient, createFakeHttpClient } from "./operator-ui.test-fixtures.js";
import { stubMatchMedia } from "./test-utils.js";

const browserNodeProviderSpy = vi.hoisted(() =>
  vi.fn(({ children }: { children: unknown }) => children),
);

vi.mock("../src/browser-node/browser-node-provider.js", () => ({
  BrowserNodeProvider: browserNodeProviderSpy,
  useBrowserNodeOptional: () => null,
}));

function createMobileState(platform: MobileHostState["platform"]): MobileHostState {
  return {
    platform,
    enabled: true,
    status: "connected",
    deviceId: `${platform}-node-1`,
    error: null,
    actions: {
      get: {
        enabled: true,
        availabilityStatus: "ready",
        unavailableReason: null,
      },
      capture_photo: {
        enabled: true,
        availabilityStatus: "ready",
        unavailableReason: null,
      },
      record: {
        enabled: true,
        availabilityStatus: "ready",
        unavailableReason: null,
      },
    },
  };
}

function createMobileHostApi(platform: MobileHostState["platform"]): MobileHostApi {
  let state = createMobileState(platform);
  let stateListener: ((nextState: MobileHostState) => void) | null = null;

  return {
    node: {
      getState: vi.fn(async () => state),
      setEnabled: vi.fn(async (enabled: boolean) => {
        state = { ...state, enabled };
        stateListener?.(state);
        return state;
      }),
      setActionEnabled: vi.fn(async (action, enabled: boolean) => {
        state = {
          ...state,
          actions: {
            ...state.actions,
            [action]: {
              ...state.actions[action],
              enabled,
            },
          },
        };
        stateListener?.(state);
        return state;
      }),
    },
    onStateChange: vi.fn((cb: (nextState: MobileHostState) => void) => {
      stateListener = cb;
      return () => {
        if (stateListener === cb) {
          stateListener = null;
        }
      };
    }),
    onNavigationRequest: vi.fn((_cb: (request: unknown) => void) => () => {}),
  };
}

function createConnectedCore() {
  const ws = new FakeWsClient(true);
  const { http } = createFakeHttpClient();
  return createOperatorCore({
    wsUrl: "ws://example.test/ws",
    httpBaseUrl: "http://example.test",
    auth: createBearerTokenAuth("test"),
    deps: { ws, http },
  });
}

async function renderOperatorUi(host: OperatorUiHostApi): Promise<{
  container: HTMLDivElement;
  root: Root;
}> {
  const core = createConnectedCore();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      React.createElement(
        OperatorUiHostProvider,
        { value: host },
        React.createElement(OperatorUiApp, { core, mode: "web" }),
      ),
    );
    await Promise.resolve();
  });

  return { container, root };
}

describe("operator-ui mobile host", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("shows the mobile platform route only for the mobile host and skips browser node wrapping", async () => {
    browserNodeProviderSpy.mockClear();
    const matchMedia = stubMatchMedia("(min-width: 768px)", true);

    try {
      const { container, root } = await renderOperatorUi({
        kind: "mobile",
        api: createMobileHostApi("ios"),
      });

      try {
        const mobileNav = container.querySelector<HTMLButtonElement>('[data-testid="nav-mobile"]');
        expect(mobileNav).not.toBeNull();
        expect(container.querySelector('[data-testid="nav-browser"]')).toBeNull();

        await act(async () => {
          mobileNav?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          await vi.dynamicImportSettled();
          await Promise.resolve();
        });

        // The unified NodeConfigPage loads mobile state asynchronously.
        // Flush additional microtasks to allow the API call to resolve.
        await act(async () => {
          await Promise.resolve();
        });
        await act(async () => {
          await Promise.resolve();
        });

        // The unified NodeConfigPage renders the mobile configuration UI.
        // The platform label is derived from the mobile state platform ("iOS"),
        // so the executor title is "iOS node executor".
        expect(container.textContent).toContain("iOS node executor");
        expect(container.textContent).toContain("iOS");
        expect(browserNodeProviderSpy).not.toHaveBeenCalled();
      } finally {
        act(() => {
          root.unmount();
        });
        container.remove();
      }
    } finally {
      matchMedia.cleanup();
    }
  });

  it("keeps the browser platform route on the web host", async () => {
    browserNodeProviderSpy.mockClear();
    const matchMedia = stubMatchMedia("(min-width: 768px)", true);

    try {
      const { container, root } = await renderOperatorUi({ kind: "web" });

      try {
        expect(container.querySelector('[data-testid="nav-browser"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="nav-mobile"]')).toBeNull();
        expect(browserNodeProviderSpy).not.toHaveBeenCalled();
      } finally {
        act(() => {
          root.unmount();
        });
        container.remove();
      }
    } finally {
      matchMedia.cleanup();
    }
  });
});
