import React, { act } from "react";
import { expect, vi } from "vitest";
import type { DesktopApi } from "../../src/desktop-api.js";
import { BrowserNodeProvider } from "../../src/browser-node/browser-node-provider.js";
import { NodeConfigurePage } from "../../src/components/pages/node-configure-page.js";
import { BrowserCapabilitiesPage } from "../../src/components/pages/platform/browser-capabilities-page.js";
import { MobilePlatformPage } from "../../src/components/pages/platform/mobile-platform-page.js";
import { OperatorUiHostProvider } from "../../src/host/host-api.js";
import type { MobileHostApi } from "../../src/host/host-api.js";
import { cleanupTestRoot, renderIntoDocument, type TestRoot } from "../test-utils.js";

type HostValue =
  | {
      kind: "web";
    }
  | {
      kind: "desktop";
      api: DesktopApi | null;
    }
  | {
      kind: "mobile";
      api: MobileHostApi;
    };

const DEFAULT_NODE_CONFIG = {
  mode: "embedded",
  embedded: { port: 8788 },
  permissions: { profile: "balanced", overrides: {} },
  capabilities: { desktop: true, playwright: true, cli: true, http: true },
  cli: { allowedCommands: [], allowedWorkingDirs: [] },
  web: { allowedDomains: [], headless: true },
} as const;

type DesktopApiOptions = {
  background?: DesktopApi["background"];
  checkMacPermissions?: DesktopApi["checkMacPermissions"];
  config?: unknown;
  gateway?: Partial<DesktopApi["gateway"]>;
  node?: Partial<DesktopApi["node"]>;
  onStatusChange?: DesktopApi["onStatusChange"];
  requestMacPermission?: DesktopApi["requestMacPermission"];
  setConfig?: DesktopApi["setConfig"];
};

export function createNodeConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...DEFAULT_NODE_CONFIG,
    ...overrides,
  };
}

function createDefaultOperatorConnection(
  rawConfig: unknown,
): Awaited<ReturnType<NonNullable<DesktopApi["gateway"]["getOperatorConnection"]>>> {
  const config = (rawConfig ?? createNodeConfig()) as Record<string, unknown>;
  const mode = config["mode"] === "remote" ? "remote" : "embedded";

  if (mode === "remote") {
    const remote =
      config["remote"] && typeof config["remote"] === "object"
        ? (config["remote"] as Record<string, unknown>)
        : {};
    const wsUrl = typeof remote["wsUrl"] === "string" ? remote["wsUrl"] : "ws://127.0.0.1:8788/ws";
    const httpBaseUrl = wsUrl.startsWith("wss://")
      ? wsUrl.replace(/^wss:\/\//, "https://").replace(/\/ws$/, "/")
      : wsUrl.replace(/^ws:\/\//, "http://").replace(/\/ws$/, "/");

    return {
      mode,
      wsUrl,
      httpBaseUrl,
      token: "saved-remote-token",
      tlsCertFingerprint256:
        typeof remote["tlsCertFingerprint256"] === "string" ? remote["tlsCertFingerprint256"] : "",
      tlsAllowSelfSigned: remote["tlsAllowSelfSigned"] === true,
    };
  }

  const embedded =
    config["embedded"] && typeof config["embedded"] === "object"
      ? (config["embedded"] as Record<string, unknown>)
      : {};
  const port = typeof embedded["port"] === "number" ? embedded["port"] : 8788;

  return {
    mode,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    httpBaseUrl: `http://127.0.0.1:${port}/`,
    token: "tyrum-token.v1.embedded.token",
    tlsCertFingerprint256: "",
    tlsAllowSelfSigned: false,
  };
}

export function createDesktopApi(options: DesktopApiOptions = {}): DesktopApi {
  const config = options.config ?? createNodeConfig();

  return {
    getConfig: vi.fn(async () => config),
    setConfig: options.setConfig ?? vi.fn(async () => {}),
    ...(options.background ? { background: options.background } : {}),
    gateway: {
      getStatus: vi.fn(async () => ({ status: "running", port: 8788 })),
      start: vi.fn(async () => ({ status: "running", port: 8788 })),
      stop: vi.fn(async () => ({ status: "stopped" })),
      getOperatorConnection: vi.fn(async () => createDefaultOperatorConnection(config)),
      ...options.gateway,
    },
    node: {
      connect: vi.fn(async () => ({ status: "connected" })),
      disconnect: vi.fn(async () => ({ status: "disconnected" })),
      ...options.node,
    },
    onStatusChange: options.onStatusChange ?? vi.fn((_cb: (status: unknown) => void) => () => {}),
    ...(options.checkMacPermissions ? { checkMacPermissions: options.checkMacPermissions } : {}),
    ...(options.requestMacPermission ? { requestMacPermission: options.requestMacPermission } : {}),
  } satisfies DesktopApi;
}

export async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

export async function clickButtonAndFlush(container: HTMLElement, label: string): Promise<void> {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((el) =>
    el.textContent?.includes(label),
  );
  expect(button).not.toBeUndefined();
  await clickElementAndFlush(button);
}

export async function clickByTestIdAndFlush(container: HTMLElement, testId: string): Promise<void> {
  const button = container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  expect(button).not.toBeNull();
  await clickElementAndFlush(button);
}

export async function clickLabelAndFlush(container: HTMLElement, labelText: string): Promise<void> {
  const label = Array.from(container.querySelectorAll<HTMLLabelElement>("label")).find((el) =>
    el.textContent?.includes(labelText),
  );
  expect(label).not.toBeUndefined();
  await clickElementAndFlush(label);
}

export async function clickSwitchAndFlush(container: HTMLElement, index: number): Promise<void> {
  const toggle = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="switch"]'))[
    index
  ];
  expect(toggle).not.toBeUndefined();
  await clickElementAndFlush(toggle);
}

export async function clickTabAndFlush(container: HTMLElement, label: string): Promise<void> {
  const tab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((el) =>
    el.textContent?.includes(label),
  );
  expect(tab).not.toBeUndefined();
  await act(async () => {
    tab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    await Promise.resolve();
  });
}

export function getInputByLabel(container: HTMLElement, labelText: string): HTMLInputElement {
  const label = Array.from(container.querySelectorAll<HTMLLabelElement>("label")).find((el) =>
    el.textContent?.includes(labelText),
  );
  expect(label).not.toBeUndefined();
  const id = label?.getAttribute("for");
  expect(id).toBeTruthy();
  const input = id ? container.querySelector<HTMLInputElement>(`input[id="${id}"]`) : null;
  expect(input).not.toBeNull();
  return input!;
}

export function getTextareaByLabel(container: HTMLElement, labelText: string): HTMLTextAreaElement {
  const label = Array.from(container.querySelectorAll<HTMLLabelElement>("label")).find((el) =>
    el.textContent?.includes(labelText),
  );
  expect(label).not.toBeUndefined();
  const id = label?.getAttribute("for");
  expect(id).toBeTruthy();
  const textarea = id ? container.querySelector<HTMLTextAreaElement>(`textarea[id="${id}"]`) : null;
  expect(textarea).not.toBeNull();
  return textarea!;
}

export async function withBrowserCapabilitiesPage(
  run: (testRoot: TestRoot) => Promise<void> | void,
): Promise<void> {
  await withRenderedElement(
    React.createElement(
      BrowserNodeProvider,
      { wsUrl: "ws://example.test/ws" },
      React.createElement(BrowserCapabilitiesPage),
    ),
    run,
  );
}

export async function withDesktopNodeConfigurePage(
  api: DesktopApi,
  run: (testRoot: TestRoot) => Promise<void> | void,
  props?: React.ComponentProps<typeof NodeConfigurePage>,
): Promise<void> {
  await withNodeConfigurePage({ kind: "desktop", api }, run, props);
}

export function createMobileHostApi(
  overrides: Partial<MobileHostApi> = {},
  initialState?: Partial<Awaited<ReturnType<MobileHostApi["node"]["getState"]>>>,
): MobileHostApi {
  const state = {
    platform: "ios" as const,
    enabled: true,
    status: "connected" as const,
    deviceId: "mobile-node-1",
    error: null,
    actions: {
      "location.get_current": {
        enabled: true,
        availabilityStatus: "ready" as const,
      },
      "camera.capture_photo": {
        enabled: true,
        availabilityStatus: "ready" as const,
      },
      "audio.record_clip": {
        enabled: true,
        availabilityStatus: "ready" as const,
      },
    },
    ...initialState,
  };

  return {
    node: {
      getState: vi.fn(async () => state),
      setEnabled: vi.fn(async (enabled: boolean) => ({ ...state, enabled })),
      setActionEnabled: vi.fn(
        async (action, enabled: boolean) =>
          ({
            ...state,
            actions: {
              ...state.actions,
              [action]: {
                ...state.actions[action],
                enabled,
              },
            },
          }) as typeof state,
      ),
    },
    onStateChange: vi.fn((_cb: (nextState: typeof state) => void) => () => {}),
    onNavigationRequest: vi.fn((_cb: (request: unknown) => void) => () => {}),
    ...overrides,
  };
}

export async function withMobilePlatformPage(
  api: MobileHostApi,
  run: (testRoot: TestRoot) => Promise<void> | void,
): Promise<void> {
  await withRenderedElement(
    React.createElement(
      OperatorUiHostProvider,
      { value: { kind: "mobile", api } },
      React.createElement(MobilePlatformPage),
    ),
    run,
  );
}

export async function withHostNodeConfigurePage(
  host: HostValue,
  run: (testRoot: TestRoot) => Promise<void> | void,
  props?: React.ComponentProps<typeof NodeConfigurePage>,
): Promise<void> {
  await withNodeConfigurePage(host, run, props);
}

async function clickElementAndFlush(element: HTMLElement | null | undefined): Promise<void> {
  await act(async () => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

async function withNodeConfigurePage(
  host: HostValue,
  run: (testRoot: TestRoot) => Promise<void> | void,
  props?: React.ComponentProps<typeof NodeConfigurePage>,
): Promise<void> {
  await withRenderedElement(
    React.createElement(
      OperatorUiHostProvider,
      { value: host },
      React.createElement(NodeConfigurePage, props),
    ),
    run,
  );
}

async function withRenderedElement(
  element: React.ReactElement,
  run: (testRoot: TestRoot) => Promise<void> | void,
): Promise<void> {
  const testRoot = renderIntoDocument(element);
  try {
    await run(testRoot);
  } finally {
    cleanupTestRoot(testRoot);
  }
}
