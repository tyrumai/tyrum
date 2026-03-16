// @vitest-environment jsdom

import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "../../operator-core/src/store.js";
import { OperatorUiApp } from "../src/app.js";
import { click, cleanupTestRoot, renderIntoDocument } from "./test-utils.js";

const e = React.createElement;
const mountState = vi.hoisted(() => ({
  chatMounts: 0,
  chatUnmounts: 0,
}));

vi.mock("../src/hooks/use-theme.js", () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => e(React.Fragment, null, children),
  useThemeOptional: vi.fn(() => null),
}));

vi.mock("../src/browser-node/browser-node-provider.js", () => ({
  BrowserNodeProvider: ({ children }: { children: React.ReactNode }) =>
    e(React.Fragment, null, children),
}));

vi.mock("../src/components/layout/app-shell.js", () => ({
  AppShell: ({
    children,
    mobileNav,
    sidebar,
  }: {
    children: React.ReactNode;
    mobileNav?: React.ReactNode;
    sidebar?: React.ReactNode;
  }) => e("div", null, sidebar, mobileNav, children),
}));

vi.mock("../src/components/layout/sidebar.js", () => ({
  Sidebar: ({
    items,
    onNavigate,
  }: {
    items: Array<{ id: string; label: string }>;
    onNavigate: (id: string) => void;
  }) =>
    e(
      "div",
      { "data-testid": "mock-sidebar" },
      ...items.map((item) =>
        e(
          "button",
          {
            key: item.id,
            "data-testid": `mock-nav-${item.id}`,
            onClick: () => onNavigate(item.id),
            type: "button",
          },
          item.label,
        ),
      ),
    ),
}));

vi.mock("../src/components/layout/mobile-nav.js", () => ({
  MobileNav: () => null,
}));

vi.mock("../src/components/ui/scroll-area.js", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => e("div", null, children),
}));

vi.mock("../src/components/toast/toast-provider.js", () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => e(React.Fragment, null, children),
}));

vi.mock("../src/elevated-mode.js", () => ({
  AdminAccessProvider: ({ children }: { children: React.ReactNode }) =>
    e(React.Fragment, null, children),
}));

vi.mock("../src/reconnect-ui-state.js", () => ({
  RetainedUiStateProvider: ({ children }: { children: React.ReactNode }) =>
    e(React.Fragment, null, children),
}));

vi.mock("../src/host/host-api.js", () => ({
  OperatorUiHostProvider: ({ children }: { children: React.ReactNode }) =>
    e(React.Fragment, null, children),
  useHostApiOptional: vi.fn(() => null),
}));

vi.mock("../src/desktop-api.js", () => ({
  getDesktopApi: vi.fn(() => null),
}));

vi.mock("../src/components/error/error-boundary.js", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => e(React.Fragment, null, children),
}));

vi.mock("../src/components/pages/first-run-onboarding.js", () => ({
  FirstRunOnboardingPage: () => null,
  useFirstRunOnboardingController: vi.fn(() => ({
    isOpen: false,
    available: false,
    close: vi.fn(),
    skip: vi.fn(),
    markCompleted: vi.fn(),
    open: vi.fn(),
  })),
}));

vi.mock("../src/use-operator-app-view-model.js", () => ({
  useOperatorAppViewModel: () => {
    const [route, setRoute] = React.useState("chat");
    return {
      route,
      navigate: setRoute,
      showShell: true,
      showConnectPage: false,
      sidebarItems: [
        { id: "dashboard", label: "Dashboard" },
        { id: "chat", label: "Chat" },
        { id: "approvals", label: "Approvals" },
      ],
      platformItems: [],
      mobileItems: [],
      mobileOverflowItems: [],
      connection: {
        status: "connected" as const,
        recovering: false,
      },
      autoSync: {
        isSyncing: false,
      },
    };
  },
}));

vi.mock("../src/operator-routes.js", () => ({
  CONNECT_PAGE_RENDER: () => e("div", { "data-testid": "mock-connect-route" }, "Connect"),
  getOperatorRouteDefinition: (id: string) => {
    if (id === "dashboard") {
      return {
        id,
        render: () => e("div", { "data-testid": "mock-dashboard-page" }, "Dashboard"),
      };
    }
    if (id === "chat") {
      return {
        id,
        render: () => e(MockChatPage, { "data-testid": "mock-chat-page" }, "Chat"),
      };
    }
    if (id === "approvals") {
      return {
        id,
        render: () => e("div", { "data-testid": "mock-approvals-page" }, "Approvals"),
      };
    }
    return null;
  },
}));

function MockChatPage() {
  React.useEffect(() => {
    mountState.chatMounts += 1;
    return () => {
      mountState.chatUnmounts += 1;
    };
  }, []);

  return e("div", { "data-testid": "mock-chat-page" }, "Chat");
}

function createCoreStub() {
  const { store: connectionStore } = createStore({
    status: "connected" as const,
    clientId: null,
    lastDisconnect: null,
    transportError: null,
  });
  return {
    connectionStore,
    httpBaseUrl: "http://localhost:8788",
    wsUrl: "ws://localhost:8788/ws",
    deviceId: null,
    syncAllNow: vi.fn(async () => undefined),
  };
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("OperatorUiApp retained chat route", () => {
  afterEach(() => {
    mountState.chatMounts = 0;
    mountState.chatUnmounts = 0;
  });

  it("keeps the chat page mounted while navigating away and back", async () => {
    const testRoot = renderIntoDocument(
      e(OperatorUiApp, {
        core: createCoreStub() as never,
        mode: "web",
      }),
    );

    await flushEffects();

    expect(mountState.chatMounts).toBe(1);
    expect(testRoot.container.querySelector("[data-testid='mock-chat-page']")).not.toBeNull();

    await act(async () => {
      click(testRoot.container.querySelector("[data-testid='mock-nav-approvals']") as HTMLElement);
      await Promise.resolve();
    });

    expect(testRoot.container.querySelector("[data-testid='mock-approvals-page']")).not.toBeNull();
    expect(mountState.chatMounts).toBe(1);
    expect(mountState.chatUnmounts).toBe(0);

    await act(async () => {
      click(testRoot.container.querySelector("[data-testid='mock-nav-chat']") as HTMLElement);
      await Promise.resolve();
    });

    expect(testRoot.container.querySelector("[data-testid='mock-chat-page']")).not.toBeNull();
    expect(mountState.chatMounts).toBe(1);
    expect(mountState.chatUnmounts).toBe(0);

    cleanupTestRoot(testRoot);
    expect(mountState.chatUnmounts).toBe(1);
  });

  it("keeps the chat page mounted when navigating to a non-approval route and back", async () => {
    const testRoot = renderIntoDocument(
      e(OperatorUiApp, {
        core: createCoreStub() as never,
        mode: "web",
      }),
    );

    await flushEffects();

    expect(mountState.chatMounts).toBe(1);

    await act(async () => {
      click(testRoot.container.querySelector("[data-testid='mock-nav-dashboard']") as HTMLElement);
      await Promise.resolve();
    });

    expect(testRoot.container.querySelector("[data-testid='mock-dashboard-page']")).not.toBeNull();
    expect(mountState.chatMounts).toBe(1);
    expect(mountState.chatUnmounts).toBe(0);

    await act(async () => {
      click(testRoot.container.querySelector("[data-testid='mock-nav-chat']") as HTMLElement);
      await Promise.resolve();
    });

    expect(testRoot.container.querySelector("[data-testid='mock-chat-page']")).not.toBeNull();
    expect(mountState.chatMounts).toBe(1);
    expect(mountState.chatUnmounts).toBe(0);

    cleanupTestRoot(testRoot);
    expect(mountState.chatUnmounts).toBe(1);
  });

  it("remounts the retained chat host when the core instance changes", async () => {
    const testRoot = renderIntoDocument(
      e(OperatorUiApp, {
        core: createCoreStub() as never,
        mode: "web",
      }),
    );

    await flushEffects();
    expect(mountState.chatMounts).toBe(1);
    expect(mountState.chatUnmounts).toBe(0);

    act(() => {
      testRoot.root.render(
        e(OperatorUiApp, {
          core: createCoreStub() as never,
          mode: "web",
        }),
      );
    });
    await flushEffects();

    expect(mountState.chatMounts).toBe(2);
    expect(mountState.chatUnmounts).toBe(1);

    cleanupTestRoot(testRoot);
    expect(mountState.chatUnmounts).toBe(2);
  });
});
