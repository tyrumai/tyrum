// @vitest-environment jsdom

import React, { act } from "react";
import { afterEach, beforeEach, vi } from "vitest";
import type { UIMessage } from "ai";
import { createChatStore } from "../../operator-app/src/stores/chat-store.js";
import { createStore } from "../../operator-app/src/store.js";
import { OperatorUiApp } from "../src/app.js";
import { renderIntoDocument, type TestRoot } from "./test-utils.js";

const e = React.createElement;
const supportsSocketMock = vi.hoisted(() => vi.fn(() => true));
const createSessionClientMock = vi.hoisted(() => vi.fn());
const createTransportMock = vi.hoisted(() => vi.fn(() => ({ transport: true })));
const toastErrorMock = vi.hoisted(() => vi.fn());
const appShellMinWidthState = vi.hoisted(() => vi.fn(() => true));
const conversationLifecycleState = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));

vi.mock("@tyrum/operator-app", () => ({
  supportsTyrumAiSdkChatSocket: supportsSocketMock,
  createTyrumAiSdkChatSessionClient: createSessionClientMock,
  createTyrumAiSdkChatTransport: createTransportMock,
}));

vi.mock("@tyrum/transport-sdk", () => ({
  supportsTyrumAiSdkChatSocket: supportsSocketMock,
  createTyrumAiSdkChatSessionClient: createSessionClientMock,
}));

vi.mock("sonner", () => ({
  toast: { error: toastErrorMock },
}));

vi.mock("../src/hooks/use-theme.js", () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => e(React.Fragment, null, children),
  useThemeOptional: vi.fn(() => null),
}));

vi.mock("../src/browser-node/browser-node-provider.js", () => ({
  BrowserNodeProvider: ({ children }: { children: React.ReactNode }) =>
    e(React.Fragment, null, children),
  useBrowserNodeOptional: vi.fn(() => null),
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
  useAppShellMinWidth: appShellMinWidthState,
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

vi.mock("../src/components/layout/mobile-nav.js", () => ({ MobileNav: () => null }));
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

vi.mock("../src/local-node-auto-approval.js", () => ({
  LocalNodeAutoApprovalBridge: () => null,
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
      connection: { status: "connected" as const, recovering: false },
      autoSync: { isSyncing: false },
    };
  },
}));

vi.mock("../src/components/pages/dashboard-page.js", () => ({
  DashboardPage: () => e("div", { "data-testid": "mock-dashboard-page" }, "Dashboard"),
}));

vi.mock("../src/components/pages/approvals-page.js", () => ({
  ApprovalsPage: ({
    core,
  }: {
    core: { approvalsStore: { resolve: (input: unknown) => Promise<unknown> } };
  }) =>
    e(
      "button",
      {
        "data-testid": "mock-approve-from-page",
        onClick: () => {
          void core.approvalsStore.resolve({ approvalId: "approval-1", decision: "approved" });
        },
        type: "button",
      },
      "Approve",
    ),
}));

vi.mock("../src/components/pages/chat-page-threads.js", () => ({
  ChatThreadsPanel: ({
    onOpenThread,
    threads,
  }: {
    onOpenThread: (sessionId: string) => void;
    threads: Array<{ preview: string; session_id: string; title: string }>;
  }) =>
    e(
      "div",
      { "data-testid": "mock-threads-panel" },
      ...threads.map((thread) =>
        e(
          "button",
          {
            key: thread.session_id,
            "data-testid": `mock-open-${thread.session_id}`,
            onClick: () => onOpenThread(thread.session_id),
            type: "button",
          },
          `${thread.title}:${thread.preview}`,
        ),
      ),
    ),
}));

function flattenMessageTexts(messages: UIMessage[]): string {
  return messages
    .flatMap((message) =>
      message.parts.flatMap((part) => {
        if (part.type === "text") return [`${message.role}:${part.text}`];
        if ((part.type === "dynamic-tool" || part.type.startsWith("tool-")) && "state" in part) {
          return [`tool:${part.state}`];
        }
        return [];
      }),
    )
    .join("|");
}

function createProgressMessages(): UIMessage[] {
  return [
    {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "Run a safe shell command" }],
    },
    {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "text", text: "approval-complete" }],
    },
  ] as unknown as UIMessage[];
}

vi.mock("../src/components/pages/chat-page-ai-sdk-conversation.js", () => ({
  AiSdkConversation: (props: {
    onBack?: () => void;
    onDelete: () => void;
    onRenderModeChange: (value: "markdown" | "text") => void;
    onResolveApproval: (input: {
      approvalId: string;
      decision: "approved" | "denied";
      mode?: "once" | "always";
    }) => void;
    onSessionMessages: (messages: UIMessage[]) => void;
    renderMode: "markdown" | "text";
    resolvingApproval: { approvalId: string } | null;
    session: { messages: UIMessage[]; session_id: string };
  }) => {
    React.useEffect(() => {
      conversationLifecycleState.mounts += 1;
      return () => {
        conversationLifecycleState.unmounts += 1;
      };
    }, []);
    return e(
      "div",
      { "data-testid": "mock-conversation" },
      e("div", { "data-testid": "mock-session-id" }, props.session.session_id),
      e("div", { "data-testid": "mock-render-mode" }, props.renderMode),
      e("div", { "data-testid": "mock-has-back" }, props.onBack ? "yes" : "no"),
      e("div", { "data-testid": "mock-resolving" }, props.resolvingApproval?.approvalId ?? ""),
      e("div", { "data-testid": "mock-message-text" }, flattenMessageTexts(props.session.messages)),
      e(
        "button",
        {
          "data-testid": "mock-stream-progress",
          onClick: () => props.onSessionMessages(createProgressMessages()),
          type: "button",
        },
        "progress",
      ),
      e(
        "button",
        {
          "data-testid": "mock-toggle-text",
          onClick: () => props.onRenderModeChange("text"),
          type: "button",
        },
        "text",
      ),
      e(
        "button",
        { "data-testid": "mock-delete", onClick: props.onDelete, type: "button" },
        "delete",
      ),
      e(
        "button",
        {
          "data-testid": "mock-resolve-from-chat",
          onClick: () =>
            props.onResolveApproval({
              approvalId: "approval-1",
              decision: "approved",
              mode: "once",
            }),
          type: "button",
        },
        "resolve",
      ),
      props.onBack
        ? e("button", { "data-testid": "mock-back", onClick: props.onBack, type: "button" }, "back")
        : null,
    );
  },
}));

vi.mock("../src/components/ui/confirm-danger-dialog.js", () => ({
  ConfirmDangerDialog: ({ onConfirm, open }: { onConfirm: () => Promise<void>; open: boolean }) =>
    open
      ? e(
          "button",
          {
            "data-testid": "mock-confirm-delete",
            onClick: () => {
              void onConfirm();
            },
            type: "button",
          },
          "confirm",
        )
      : null,
}));

function createSessionSummary(sessionId: string, preview: string) {
  return {
    session_id: sessionId,
    agent_key: "default",
    channel: "ui",
    thread_id: `thread-${sessionId}`,
    title: `Title ${sessionId}`,
    created_at: "2026-03-13T00:00:00.000Z",
    updated_at: "2026-03-13T00:00:00.000Z",
    message_count: 1,
    last_message: { role: "user" as const, text: preview },
  };
}

function createSession(sessionId: string) {
  return {
    ...createSessionSummary(sessionId, "Run a safe shell command"),
    queue_mode: "steer" as const,
    messages: [
      {
        id: "user-1",
        role: "user" as const,
        parts: [{ type: "text" as const, text: "Run a safe shell command" }],
      },
    ],
  };
}

function createApprovalsStoreStub(resolveImpl: () => Promise<unknown>) {
  const { store } = createStore({
    byId: {},
    blockedIds: ["approval-1"],
    pendingIds: ["approval-1"],
    loading: false,
    error: null,
    lastSyncedAt: null,
  });
  return { ...store, resolve: vi.fn(resolveImpl) };
}

export function createCoreStub(input?: {
  resolveApproval?: () => Promise<unknown>;
  sessionClient?: {
    create: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
  };
}) {
  const sessionClient = input?.sessionClient ?? {
    list: vi.fn(async () => ({
      sessions: [createSessionSummary("session-1", "Run a safe shell command")],
      next_cursor: null,
    })),
    get: vi.fn(async () => createSession("session-1")),
    create: vi.fn(async () => createSession("session-2")),
    delete: vi.fn(async () => undefined),
  };
  createSessionClientMock.mockReturnValue(sessionClient);
  const { store: connectionStore } = createStore({
    status: "connected" as const,
    clientId: null,
    lastDisconnect: null,
    transportError: null,
  });
  const ws = {
    connected: true,
    off: vi.fn(),
    on: vi.fn(),
    requestDynamic: vi.fn(),
    onDynamicEvent: vi.fn(),
    offDynamicEvent: vi.fn(),
  };
  const http = {
    agentList: {
      get: vi.fn(async () => ({
        agents: [{ agent_key: "default", persona: { name: "Default" } }],
      })),
    },
  };
  return {
    approvalsStore: createApprovalsStoreStub(
      input?.resolveApproval ?? (async () => ({ approval: {} as never })),
    ),
    chatStore: createChatStore(ws as never, http as never),
    connectionStore,
    deviceId: null,
    admin: http,
    http,
    httpBaseUrl: "http://localhost:8788",
    sessionClient,
    syncAllNow: vi.fn(async () => undefined),
    chatSocket: ws,
    workboard: ws,
    ws,
    wsUrl: "ws://localhost:8788/ws",
  };
}

export function createDeferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

export async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

export async function waitForSelector<T extends Element>(
  container: ParentNode,
  selector: string,
  timeoutMs = 2_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = container.querySelector<T>(selector);
    if (found) return found;
    await flushEffects();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for selector: ${selector}`);
}

export function renderRetainedAiSdkChatApp(core: object): TestRoot {
  return renderIntoDocument(e(OperatorUiApp, { core: core as never, mode: "web" }));
}

export function setAppShellMinWidth(isWide: boolean): void {
  appShellMinWidthState.mockReturnValue(isWide);
}

export function getConversationLifecycle(): { mounts: number; unmounts: number } {
  return conversationLifecycleState;
}

beforeEach(() => {
  appShellMinWidthState.mockReturnValue(true);
  conversationLifecycleState.mounts = 0;
  conversationLifecycleState.unmounts = 0;
  createSessionClientMock.mockReset();
  createTransportMock.mockClear();
  toastErrorMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});
