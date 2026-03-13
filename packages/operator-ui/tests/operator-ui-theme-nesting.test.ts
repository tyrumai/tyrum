// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createOperatorCore, createBearerTokenAuth } from "../../operator-core/src/index.js";
import type { OperatorHttpClient, OperatorWsClient } from "../../operator-core/src/deps.js";
import { ThemeProvider } from "../src/hooks/use-theme.js";
import { OperatorUiApp } from "../src/app.js";
import { cleanupTestRoot, renderIntoDocument } from "./test-utils.js";

const THEME_STORAGE_KEY = "tyrum.themeMode";

function stubLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  });
  return store;
}

vi.mock("../src/components/pages/connect-page.js", async () => {
  const ReactModule = await import("react");
  const { useTheme } = await import("../src/hooks/use-theme.js");
  return {
    ConnectPage() {
      const { mode } = useTheme();
      return ReactModule.createElement("div", { "data-testid": "theme-mode" }, mode);
    },
  };
});

class StubWsClient implements OperatorWsClient {
  connected = false;
  connect(): void {}
  disconnect(): void {}
  on(_event: string, _handler: (data: unknown) => void): void {}
  off(_event: string, _handler: (data: unknown) => void): void {}
  approvalList = async () => ({ approvals: [], next_cursor: undefined });
  runList = async () => ({ runs: [], steps: [], attempts: [] });
  approvalResolve = async () => ({ approval: {} as never });
}

const stubHttp: OperatorHttpClient = {
  status: {
    get: async () => ({ status: "ok" }) as never,
  },
  usage: {
    get: async () => ({ status: "ok" }) as never,
  },
  presence: {
    list: async () => ({ status: "ok" }) as never,
  },
  pairings: {
    list: async () => ({ status: "ok", pairings: [] }) as never,
    approve: async () => ({ status: "ok" }) as never,
    deny: async () => ({ status: "ok" }) as never,
    revoke: async () => ({ status: "ok" }) as never,
  },
  desktopEnvironmentHosts: {
    list: async () => ({ status: "ok", hosts: [] }) as never,
  },
  desktopEnvironments: {
    list: async () => ({ status: "ok", environments: [] }) as never,
    get: async () => ({ status: "ok", environment: null }) as never,
    create: async () => ({ status: "ok", environment: null }) as never,
    update: async () => ({ status: "ok", environment: null }) as never,
    start: async () => ({ status: "ok", environment: null }) as never,
    stop: async () => ({ status: "ok", environment: null }) as never,
    reset: async () => ({ status: "ok", environment: null }) as never,
    remove: async () => ({ status: "ok", deleted: true }) as never,
    logs: async () => ({ status: "ok", environment_id: "env-1", logs: [] }) as never,
  },
};

function MutateStorageDuringRender({ children }: { children: React.ReactNode }) {
  localStorage.setItem(THEME_STORAGE_KEY, "dark");
  return React.createElement(React.Fragment, null, children);
}

describe("OperatorUiApp ThemeProvider nesting", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.dataset.theme = "";
    document.documentElement.dataset.themeMode = "";
  });

  it("does not mount a nested ThemeProvider when already wrapped", async () => {
    stubLocalStorage();
    localStorage.setItem(THEME_STORAGE_KEY, "light");

    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test-token"),
      deps: {
        ws: new StubWsClient(),
        http: stubHttp,
      },
    });

    const testRoot = renderIntoDocument(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(
          MutateStorageDuringRender,
          null,
          React.createElement(OperatorUiApp, { core, mode: "web" }),
        ),
      ),
    );

    await act(async () => {
      await Promise.resolve();
    });

    const mode = testRoot.container.querySelector('[data-testid="theme-mode"]')?.textContent;
    cleanupTestRoot(testRoot);
    core.dispose();

    expect(mode).toBe("light");
  });
});
