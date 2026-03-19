import { expect, vi } from "vitest";
import type * as OperatorApp from "@tyrum/operator-app";
import type * as TransportBrowser from "@tyrum/transport-sdk/browser";
import type * as UrlAuthModule from "../src/url-auth.js";

vi.mock("@tyrum/operator-app", () => ({
  clearGatewayAuthSession: vi.fn(),
  createBearerTokenAuth: vi.fn(),
  createElevatedModeStore: vi.fn(),
  createGatewayAuthSession: vi.fn(),
  createOperatorCore: vi.fn(),
  createOperatorCoreManager: vi.fn(),
  httpAuthForAuth: vi.fn(),
}));

vi.mock("@tyrum/transport-sdk/browser", () => ({
  createDeviceIdentity: vi.fn(),
  createTyrumHttpClient: vi.fn(),
}));

vi.mock("@tyrum/operator-ui", () => ({
  ADMIN_ACCESS_SCOPES: [
    "operator.read",
    "operator.write",
    "operator.approvals",
    "operator.pairing",
    "operator.admin",
  ],
  createAdminAccessController: vi.fn(() => ({
    enter: vi.fn(async () => {}),
    exit: vi.fn(async () => {}),
  })),
  OperatorUiApp: () => null,
  OperatorUiHostProvider: ({ children }: { children: unknown }) => children ?? null,
  ThemeProvider: ({ children }: { children: unknown }) => children ?? null,
}));

vi.mock("react-dom/client", () => ({
  createRoot: vi.fn(),
}));

vi.mock("../src/url-auth.js", () => ({
  readAuthTokenFromUrl: vi.fn(),
  stripAuthTokenFromUrl: vi.fn(),
}));

vi.mock("../src/reload-page.js", () => ({
  reloadPage: vi.fn(),
}));

type OperatorCoreBrowserModule = typeof OperatorApp & typeof TransportBrowser;
type UrlAuthModuleT = typeof UrlAuthModule;

export type RootMock = { render: ReturnType<typeof vi.fn> };

export type WebAuthPersistence = {
  hasStoredToken: boolean;
  readToken?: () => Promise<string | null> | string | null;
  saveToken: (token: string) => Promise<void>;
  clearToken: () => Promise<void>;
};

export type OperatorUiAppProps = {
  adminAccessController?: {
    enter: () => Promise<void>;
    exit: () => Promise<void>;
  };
  onReloadPage: () => void;
  onReconfigureGateway: (httpUrl: string, wsUrl: string) => void;
  webAuthPersistence: WebAuthPersistence;
};

function setupDom(url: string): ReturnType<typeof vi.spyOn> {
  document.body.innerHTML = '<div id="root"></div>';
  window.history.replaceState({}, "", url);
  return vi.spyOn(window.history, "replaceState");
}

function makeManagerMock(): {
  manager: {
    getCore: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  };
  core: { connect: ReturnType<typeof vi.fn> };
  unsubscribe: ReturnType<typeof vi.fn>;
} {
  const core = { connect: vi.fn() };
  const unsubscribe = vi.fn();
  return {
    core,
    unsubscribe,
    manager: {
      getCore: vi.fn(() => core),
      subscribe: vi.fn(() => unsubscribe),
      dispose: vi.fn(),
    },
  };
}

export function resetWebMainTestState(): void {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  localStorage.clear();
  document.body.innerHTML = "";
}

export function expectDisposedOnUnload(params: {
  unsubscribe: ReturnType<typeof vi.fn>;
  manager: { dispose: ReturnType<typeof vi.fn> };
  elevatedModeStore: { dispose: ReturnType<typeof vi.fn> };
}): void {
  window.dispatchEvent(new Event("beforeunload"));
  expect(params.unsubscribe).toHaveBeenCalledTimes(1);
  expect(params.manager.dispose).toHaveBeenCalledTimes(1);
  expect(params.elevatedModeStore.dispose).toHaveBeenCalledTimes(1);
}

export async function arrangeBootstrap(initialUrl: string) {
  const replaceStateSpy = setupDom(initialUrl);
  const operatorApp = await import("@tyrum/operator-app");
  const transportBrowser = await import("@tyrum/transport-sdk/browser");
  const operatorCore = { ...operatorApp, ...transportBrowser } as OperatorCoreBrowserModule;
  const reloadPage = await import("../src/reload-page.js");
  const urlAuth = await import("../src/url-auth.js");
  const reactDomClient = await import("react-dom/client");

  const elevatedModeStore = { dispose: vi.fn() };
  vi.mocked(operatorApp.createElevatedModeStore).mockReturnValue(
    elevatedModeStore as unknown as ReturnType<typeof operatorApp.createElevatedModeStore>,
  );
  const deviceIdentity = {
    deviceId: "web-device-1",
    publicKey: "test-public-key",
    privateKey: "test-private-key",
  };
  vi.mocked(transportBrowser.createDeviceIdentity).mockResolvedValue(
    deviceIdentity as unknown as Awaited<ReturnType<typeof transportBrowser.createDeviceIdentity>>,
  );
  vi.mocked(operatorApp.createOperatorCore).mockReturnValue({} as never);
  vi.mocked(operatorApp.createGatewayAuthSession).mockResolvedValue(
    new Response(null, { status: 204 }),
  );
  vi.mocked(operatorApp.clearGatewayAuthSession).mockResolvedValue(
    new Response(null, { status: 204 }),
  );
  vi.mocked(operatorApp.httpAuthForAuth).mockReturnValue({ type: "bearer", token: "baseline" });
  vi.mocked(transportBrowser.createTyrumHttpClient).mockReturnValue({
    deviceTokens: { issue: vi.fn(), revoke: vi.fn() },
  } as never);
  vi.mocked(operatorApp.createBearerTokenAuth).mockImplementation(((token: string) => ({
    type: "bearer-token",
    token,
  })) as typeof operatorApp.createBearerTokenAuth);

  const { manager, unsubscribe, core } = makeManagerMock();
  vi.mocked(operatorApp.createOperatorCoreManager).mockReturnValue(
    manager as unknown as ReturnType<typeof operatorApp.createOperatorCoreManager>,
  );

  const root = { render: vi.fn() };
  vi.mocked(reactDomClient.createRoot).mockReturnValue(root as never);

  return {
    elevatedModeStore,
    deviceIdentity,
    manager,
    operatorCore,
    replaceStateSpy,
    root,
    core,
    unsubscribe,
    reloadPage,
    urlAuth,
  };
}

export const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export function getRenderedOperatorUiProps(root: RootMock): OperatorUiAppProps {
  const strictModeElement = root.render.mock.calls.at(-1)?.[0] as {
    props?: { children?: { props?: { children?: { props?: OperatorUiAppProps } } } };
  };
  const props = strictModeElement?.props?.children?.props?.children?.props;
  expect(props).toBeDefined();
  return props as OperatorUiAppProps;
}

export function useNoUrlToken(urlAuth: UrlAuthModuleT): void {
  vi.mocked(urlAuth.readAuthTokenFromUrl).mockReturnValue(undefined);
  vi.mocked(urlAuth.stripAuthTokenFromUrl).mockReturnValue("/ui");
}

export function useUrlToken(urlAuth: UrlAuthModuleT, token: string, strippedUrl = "/ui"): void {
  vi.mocked(urlAuth.readAuthTokenFromUrl).mockReturnValue(token);
  vi.mocked(urlAuth.stripAuthTokenFromUrl).mockReturnValue(strippedUrl);
}

export function expectGatewaySessionSync(
  operatorCore: OperatorCoreBrowserModule,
  token: string,
  httpBaseUrl = window.location.origin,
): void {
  expect(operatorCore.createGatewayAuthSession).toHaveBeenCalledWith({
    token,
    httpBaseUrl,
    credentials: "include",
  });
}

export function expectGatewayLogout(
  operatorCore: OperatorCoreBrowserModule,
  httpBaseUrl = window.location.origin,
): void {
  expect(operatorCore.clearGatewayAuthSession).toHaveBeenCalledWith({
    httpBaseUrl,
    credentials: "include",
  });
}
