import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  exposeInMainWorldMock,
  ipcRendererInvokeMock,
  ipcRendererOnMock,
  ipcRendererRemoveListenerMock,
} = vi.hoisted(() => {
  return {
    exposeInMainWorldMock: vi.fn(),
    ipcRendererInvokeMock: vi.fn(),
    ipcRendererOnMock: vi.fn(),
    ipcRendererRemoveListenerMock: vi.fn(),
  };
});

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: exposeInMainWorldMock,
  },
  ipcRenderer: {
    invoke: ipcRendererInvokeMock,
    on: ipcRendererOnMock,
    removeListener: ipcRendererRemoveListenerMock,
  },
}));

type PreloadApi = {
  configExists: () => Promise<unknown>;
  getConfig: () => Promise<unknown>;
  setConfig: (partial: unknown) => Promise<unknown>;
  theme: {
    getState: () => Promise<unknown>;
    onChange: (cb: (state: unknown) => void) => () => void;
  };
  updates: {
    getState: () => Promise<unknown>;
    check: () => Promise<unknown>;
    download: () => Promise<unknown>;
    install: () => Promise<unknown>;
    openReleaseFile: () => Promise<unknown>;
  };
  gateway: {
    start: () => Promise<unknown>;
    stop: () => Promise<unknown>;
    getStatus: () => Promise<unknown>;
    getOperatorConnection: () => Promise<unknown>;
    httpFetch: (input: {
      url: string;
      init?: { method?: string; headers?: Record<string, string>; body?: string };
    }) => Promise<unknown>;
  };
  node: {
    connect: () => Promise<unknown>;
    disconnect: () => Promise<unknown>;
  };
  onStatusChange: (cb: (status: unknown) => void) => () => void;
  onLog: (cb: (entry: unknown) => void) => () => void;
  onConsentRequest: (cb: (req: unknown) => void) => () => void;
  consentRespond: (requestId: string, approved: boolean, reason?: string) => Promise<unknown>;
  checkMacPermissions: () => Promise<unknown>;
  requestMacPermission: (permission: "accessibility" | "screenRecording") => Promise<unknown>;
  openExternal: (url: string) => Promise<unknown>;
  onUpdateStateChange: (cb: (state: unknown) => void) => () => void;
  onNavigationRequest: (cb: (req: unknown) => void) => () => void;
  consumeDeepLink: () => Promise<unknown>;
  onDeepLinkOpen: (cb: (url: string) => void) => () => void;
};

async function importPreloadApi(): Promise<PreloadApi> {
  vi.resetModules();
  exposeInMainWorldMock.mockClear();
  ipcRendererInvokeMock.mockReset();
  ipcRendererOnMock.mockReset();
  ipcRendererRemoveListenerMock.mockReset();

  await import("../src/preload/index.ts");

  const api = exposeInMainWorldMock.mock.calls[0]?.[1];
  expect(api).toBeDefined();
  return api as PreloadApi;
}

function getRegisteredListener(
  channel: string,
): ((event: unknown, payload: unknown) => void) | undefined {
  return ipcRendererOnMock.mock.calls.find(
    ([registeredChannel]) => registeredChannel === channel,
  )?.[1] as ((event: unknown, payload: unknown) => void) | undefined;
}

describe("preload theme bridge", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("exposes theme state getters and subscription helpers", async () => {
    const api = await importPreloadApi();

    expect(api.theme).toBeDefined();
    expect(api.theme).toMatchObject({
      getState: expect.any(Function),
      onChange: expect.any(Function),
    });
  });

  it("theme.getState invokes the main theme handler", async () => {
    const api = await importPreloadApi();

    expect(api.theme.getState).toBeTypeOf("function");

    const state = { colorScheme: "dark", highContrast: false };
    ipcRendererInvokeMock.mockResolvedValue(state);

    await expect(api.theme.getState()).resolves.toEqual(state);
    expect(ipcRendererInvokeMock).toHaveBeenCalledWith("theme:get-state");
  });

  it("theme.onChange subscribes to theme updates and can unsubscribe", async () => {
    const api = await importPreloadApi();

    expect(api.theme.onChange).toBeTypeOf("function");

    const callback = vi.fn();
    const unsubscribe = api.theme.onChange(callback);
    expect(unsubscribe).toBeTypeOf("function");

    expect(ipcRendererOnMock).toHaveBeenCalledWith("theme:state", expect.any(Function));
    const listener = ipcRendererOnMock.mock.calls[0]?.[1] as
      | ((event: unknown, state: unknown) => void)
      | undefined;
    expect(listener).toBeTypeOf("function");

    listener?.({}, { colorScheme: "light", highContrast: false });
    expect(callback).toHaveBeenCalledWith({ colorScheme: "light", highContrast: false });

    unsubscribe();
    expect(ipcRendererRemoveListenerMock).toHaveBeenCalledWith("theme:state", listener);
  });

  it("forwards config, updates, gateway, node, permission, and shell requests through ipcRenderer.invoke", async () => {
    const api = await importPreloadApi();

    await api.configExists();
    await api.getConfig();
    await api.setConfig({ autoStartGateway: true });
    await api.updates.getState();
    await api.updates.check();
    await api.updates.download();
    await api.updates.install();
    await api.updates.openReleaseFile();
    await api.gateway.start();
    await api.gateway.stop();
    await api.gateway.getStatus();
    await api.gateway.getOperatorConnection();
    await api.gateway.httpFetch({
      url: "https://gateway.internal/api",
      init: {
        method: "POST",
        headers: { authorization: "Bearer test" },
        body: '{"ok":true}',
      },
    });
    await api.node.connect();
    await api.node.disconnect();
    await api.consentRespond("req-123", true, "approved");
    await api.checkMacPermissions();
    await api.requestMacPermission("accessibility");
    await api.openExternal("https://docs.tyrum.dev");
    await api.consumeDeepLink();

    expect(ipcRendererInvokeMock.mock.calls).toEqual([
      ["config:exists"],
      ["config:get"],
      ["config:set", { autoStartGateway: true }],
      ["updates:state"],
      ["updates:check"],
      ["updates:download"],
      ["updates:install"],
      ["updates:open-release-file"],
      ["gateway:start"],
      ["gateway:stop"],
      ["gateway:status"],
      ["gateway:operator-connection"],
      [
        "gateway:http-fetch",
        {
          url: "https://gateway.internal/api",
          init: {
            method: "POST",
            headers: { authorization: "Bearer test" },
            body: '{"ok":true}',
          },
        },
      ],
      ["node:connect"],
      ["node:disconnect"],
      ["consent:respond", "req-123", true, "approved"],
      ["permissions:check-mac"],
      ["permissions:request-mac", "accessibility"],
      ["shell:open-external", "https://docs.tyrum.dev"],
      ["deeplink:consume"],
    ]);
  });

  it("registers desktop status, log, consent, update, and navigation listeners and unsubscribes them", async () => {
    const api = await importPreloadApi();

    const statusCallback = vi.fn();
    const logCallback = vi.fn();
    const consentCallback = vi.fn();
    const updateCallback = vi.fn();
    const navigationCallback = vi.fn();

    const unsubscribeStatus = api.onStatusChange(statusCallback);
    const unsubscribeLog = api.onLog(logCallback);
    const unsubscribeConsent = api.onConsentRequest(consentCallback);
    const unsubscribeUpdate = api.onUpdateStateChange(updateCallback);
    const unsubscribeNavigation = api.onNavigationRequest(navigationCallback);

    getRegisteredListener("status:change")?.({}, { state: "running" });
    getRegisteredListener("log:entry")?.({}, { level: "info" });
    getRegisteredListener("consent:request")?.({}, { requestId: "consent-1" });
    getRegisteredListener("update:state")?.({}, { status: "downloaded" });
    getRegisteredListener("navigation:request")?.({}, { href: "/settings" });

    expect(statusCallback).toHaveBeenCalledWith({ state: "running" });
    expect(logCallback).toHaveBeenCalledWith({ level: "info" });
    expect(consentCallback).toHaveBeenCalledWith({ requestId: "consent-1" });
    expect(updateCallback).toHaveBeenCalledWith({ status: "downloaded" });
    expect(navigationCallback).toHaveBeenCalledWith({ href: "/settings" });

    const statusListener = getRegisteredListener("status:change");
    const logListener = getRegisteredListener("log:entry");
    const consentListener = getRegisteredListener("consent:request");
    const updateListener = getRegisteredListener("update:state");
    const navigationListener = getRegisteredListener("navigation:request");

    unsubscribeStatus();
    unsubscribeLog();
    unsubscribeConsent();
    unsubscribeUpdate();
    unsubscribeNavigation();

    expect(ipcRendererRemoveListenerMock.mock.calls).toEqual(
      expect.arrayContaining([
        ["status:change", statusListener],
        ["log:entry", logListener],
        ["consent:request", consentListener],
        ["update:state", updateListener],
        ["navigation:request", navigationListener],
      ]),
    );
  });

  it("ignores non-string deep link events", async () => {
    const api = await importPreloadApi();

    const callback = vi.fn();
    const unsubscribe = api.onDeepLinkOpen(callback);
    const listener = getRegisteredListener("deeplink:open");

    listener?.({}, { href: "tyrum://ignored" });
    expect(callback).not.toHaveBeenCalled();

    listener?.({}, "tyrum://open");
    expect(callback).toHaveBeenCalledWith("tyrum://open");

    unsubscribe();
    expect(ipcRendererRemoveListenerMock).toHaveBeenCalledWith("deeplink:open", listener);
  });
});
