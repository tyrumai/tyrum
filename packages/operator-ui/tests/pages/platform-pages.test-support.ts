import React, { act } from "react";
import { expect, vi } from "vitest";
import type { DesktopApi } from "../../src/desktop-api.js";
import {
  BrowserNodeProvider,
  type BrowserNodeApi,
} from "../../src/browser-node/browser-node-provider.js";
import { NodeConfigPage } from "../../src/components/pages/node-config/node-config-page.js";
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

function HarnessBrowserNodeProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabled] = React.useState(false);
  const [capabilityStates, setCapabilityStates] = React.useState<
    BrowserNodeApi["capabilityStates"]
  >({
    get: { supported: true, enabled: true, availability_status: "available" },
    capture_photo: { supported: true, enabled: true, availability_status: "unknown" },
    record: { supported: true, enabled: true, availability_status: "unknown" },
  });

  const value = React.useMemo<BrowserNodeApi>(
    () => ({
      enabled,
      status: enabled ? "connected" : "disabled",
      deviceId: enabled ? "browser-node-1" : null,
      clientId: enabled ? "browser-client-1" : null,
      error: null,
      capabilityStates,
      setEnabled,
      setCapabilityEnabled(capability, nextEnabled) {
        setCapabilityStates((current) => ({
          ...current,
          [capability]: {
            ...current[capability],
            enabled: nextEnabled,
          },
        }));
      },
      async executeLocal() {
        return { success: false, error: "not implemented in platform page harness" };
      },
    }),
    [capabilityStates, enabled],
  );

  return React.createElement(BrowserNodeProvider, { value }, children);
}

const DEFAULT_NODE_CONFIG = {
  mode: "embedded",
  embedded: { port: 8788 },
  permissions: { profile: "balanced", overrides: {} },
  capabilities: { desktop: true, playwright: true },
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

export async function clickSwitchByAriaLabelAndFlush(
  container: HTMLElement,
  ariaLabel: string,
): Promise<void> {
  const toggle = container.querySelector<HTMLButtonElement>(
    `[role="switch"][aria-label="${ariaLabel}"]`,
  );
  expect(toggle).not.toBeNull();
  await clickElementAndFlush(toggle);
}

export async function expandCapabilityCard(
  container: HTMLElement,
  capabilityLabel: string,
): Promise<void> {
  // Find the expand button near the capability whose label matches.
  // Each capability card has a Switch with aria-label "Toggle <label>".
  // The expand button is in the same card, with aria-label "Expand".
  const switches = Array.from(
    container.querySelectorAll<HTMLButtonElement>(
      `[role="switch"][aria-label="Toggle ${capabilityLabel}"]`,
    ),
  );
  expect(switches.length).toBeGreaterThan(0);
  const card =
    switches[0]!.closest('[class*="card"]') ??
    switches[0]!.parentElement?.parentElement?.parentElement?.parentElement;
  expect(card).not.toBeNull();
  const expandButton = card?.querySelector<HTMLButtonElement>('[aria-label="Expand"]');
  if (expandButton) {
    await clickElementAndFlush(expandButton);
  }
  // If already expanded (aria-label="Collapse"), do nothing.
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
      HarnessBrowserNodeProvider,
      undefined,
      React.createElement(
        OperatorUiHostProvider,
        { value: { kind: "web" as const } },
        React.createElement(NodeConfigPage),
      ),
    ),
    run,
  );
}

export async function withDesktopNodeConfigPage(
  api: DesktopApi,
  run: (testRoot: TestRoot) => Promise<void> | void,
  props?: React.ComponentProps<typeof NodeConfigPage>,
): Promise<void> {
  await withNodeConfigPage({ kind: "desktop", api }, run, props);
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
      get: {
        enabled: true,
        availabilityStatus: "ready" as const,
      },
      capture_photo: {
        enabled: true,
        availabilityStatus: "ready" as const,
      },
      record: {
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
      React.createElement(NodeConfigPage),
    ),
    run,
  );
}

export async function withHostNodeConfigPage(
  host: HostValue,
  run: (testRoot: TestRoot) => Promise<void> | void,
  props?: React.ComponentProps<typeof NodeConfigPage>,
): Promise<void> {
  await withNodeConfigPage(host, run, props);
}

async function clickElementAndFlush(element: HTMLElement | null | undefined): Promise<void> {
  await act(async () => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

async function withNodeConfigPage(
  host: HostValue,
  run: (testRoot: TestRoot) => Promise<void> | void,
  props?: React.ComponentProps<typeof NodeConfigPage>,
): Promise<void> {
  await withRenderedElement(
    React.createElement(
      OperatorUiHostProvider,
      { value: host },
      React.createElement(NodeConfigPage, props),
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

// Backward-compatible aliases for existing test call sites.
export const withDesktopNodeConfigurePage = withDesktopNodeConfigPage;
export const withHostNodeConfigurePage = withHostNodeConfigPage;
