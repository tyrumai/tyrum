import { useCallback, useEffect, useSyncExternalStore, useState } from "react";
import {
  ApprovalsPage,
  MemoryPage,
  PairingPage,
  RunsPage,
  SettingsPage,
  ToastProvider,
  type SidebarConnectionStatus,
} from "@tyrum/operator-ui";
import { Layout } from "./components/Layout.js";
import { OperatorPageGuard } from "./components/OperatorPageGuard.js";
import { Dashboard } from "./pages/Dashboard.js";
import { ConnectionPage } from "./pages/ConnectionPage.js";
import { Permissions } from "./pages/Permissions.js";
import { WorkBoard } from "./pages/WorkBoard.js";
import { DebugPage } from "./pages/DebugPage.js";
import { ConsentModal } from "./components/ConsentModal.js";
import { getDeepLinkRoute } from "./deep-links.js";
import { useDesktopOperatorCore } from "./lib/desktop-operator-core.js";

type PageId =
  | "dashboard"
  | "approvals"
  | "runs"
  | "work"
  | "memory"
  | "connection"
  | "pairing"
  | "permissions"
  | "settings"
  | "debug";

const VALID_PAGES = new Set<PageId>([
  "dashboard",
  "approvals",
  "runs",
  "work",
  "memory",
  "connection",
  "pairing",
  "permissions",
  "settings",
  "debug",
]);

/** Resolve legacy page IDs to their new equivalents. */
const PAGE_ALIASES: Record<string, PageId> = {
  gateway: "dashboard",
  overview: "dashboard",
  diagnostics: "debug",
  logs: "debug",
};

function resolvePageId(raw: string): PageId | null {
  if (VALID_PAGES.has(raw as PageId)) return raw as PageId;
  return PAGE_ALIASES[raw] ?? null;
}

type DesktopGatewayMode = "embedded" | "remote";

function readGatewayMode(config: unknown): DesktopGatewayMode {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return "embedded";
  }
  return (config as Record<string, unknown>)["mode"] === "remote" ? "remote" : "embedded";
}

/** Subscribes to operator core connection status via useSyncExternalStore. */
function useConnectionStatus(
  core: import("@tyrum/operator-core").OperatorCore | null,
): SidebarConnectionStatus {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!core) return () => {};
      return core.connectionStore.subscribe(onStoreChange);
    },
    [core],
  );
  const getSnapshot = useCallback(
    (): SidebarConnectionStatus => core?.connectionStore.getSnapshot().status ?? "disconnected",
    [core],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function App() {
  const [page, setPage] = useState<PageId>("dashboard");
  const [workItemToOpen, setWorkItemToOpen] = useState<string | null>(null);
  const [pendingDeepLinkUrl, setPendingDeepLinkUrl] = useState<string | null>(null);
  const [hasSavedConfig, setHasSavedConfig] = useState<boolean | null>(null);
  const [gatewayMode, setGatewayMode] = useState<DesktopGatewayMode>("embedded");

  const refreshConfigState = useCallback(async (): Promise<void> => {
    const api = window.tyrumDesktop;
    if (!api?.configExists || !api.getConfig) return;

    const [exists, config] = await Promise.all([api.configExists(), api.getConfig()]);
    setHasSavedConfig(exists);
    setGatewayMode(readGatewayMode(config));
  }, []);

  useEffect(() => {
    void refreshConfigState();
  }, [refreshConfigState]);

  const operatorCore = useDesktopOperatorCore({ enabled: hasSavedConfig === true });
  const connectionStatus = useConnectionStatus(operatorCore.core);

  const setupGateActive =
    hasSavedConfig !== true ||
    operatorCore.errorMessage !== null ||
    (hasSavedConfig === true && gatewayMode === "remote" && connectionStatus !== "connected");

  const effectivePage: PageId = setupGateActive ? "connection" : page;

  const handleNavigate = useCallback(
    (nextPage: string): void => {
      const resolved = resolvePageId(nextPage);
      if (resolved) {
        if (setupGateActive && resolved !== "connection") {
          return;
        }
        setPage(resolved);
      }
    },
    [setupGateActive],
  );

  useEffect(() => {
    const api = window.tyrumDesktop;
    if (!api?.onNavigationRequest) return;

    const unsubscribe = api.onNavigationRequest((req) => {
      if (req === null || typeof req !== "object" || Array.isArray(req)) {
        return;
      }
      const pageId = (req as Record<string, unknown>)["pageId"];
      if (typeof pageId !== "string") {
        return;
      }
      handleNavigate(pageId);
    });

    return unsubscribe;
  }, [handleNavigate]);

  useEffect(() => {
    const api = window.tyrumDesktop;
    if (!api?.consumeDeepLink || !api.onDeepLinkOpen) return;

    const handleDeepLink = (url: string): void => {
      if (setupGateActive) {
        setPendingDeepLinkUrl(url);
        return;
      }
      const route = getDeepLinkRoute(url);
      handleNavigate(route.pageId);
      if (route.pageId === "work" && route.workItemId) {
        setWorkItemToOpen(route.workItemId);
      }
    };

    void api.consumeDeepLink().then((url) => {
      if (typeof url === "string") {
        handleDeepLink(url);
      }
    });

    const unsubscribe = api.onDeepLinkOpen((url) => {
      handleDeepLink(url);
      void api.consumeDeepLink();
    });

    return unsubscribe;
  }, [handleNavigate, setupGateActive]);

  useEffect(() => {
    if (setupGateActive) return;
    if (!pendingDeepLinkUrl) return;

    const url = pendingDeepLinkUrl;
    setPendingDeepLinkUrl(null);
    const route = getDeepLinkRoute(url);
    handleNavigate(route.pageId);
    if (route.pageId === "work" && route.workItemId) {
      setWorkItemToOpen(route.workItemId);
    }
  }, [handleNavigate, pendingDeepLinkUrl, setupGateActive]);

  const renderPage = () => {
    switch (effectivePage) {
      case "dashboard":
        return <Dashboard core={operatorCore.core} onNavigate={handleNavigate} />;
      case "approvals":
        return (
          <OperatorPageGuard {...operatorCore} render={(core) => <ApprovalsPage core={core} />} />
        );
      case "runs":
        return <OperatorPageGuard {...operatorCore} render={(core) => <RunsPage core={core} />} />;
      case "work":
        return (
          <WorkBoard
            deepLinkWorkItemId={workItemToOpen}
            onDeepLinkHandled={() => setWorkItemToOpen(null)}
          />
        );
      case "memory":
        return (
          <OperatorPageGuard {...operatorCore} render={(core) => <MemoryPage core={core} />} />
        );
      case "connection":
        return (
          <ConnectionPage
            core={operatorCore.core}
            busy={operatorCore.busy}
            errorMessage={operatorCore.errorMessage}
            retry={operatorCore.retry}
            configExists={hasSavedConfig === true}
            refreshConfigState={refreshConfigState}
            setupGateActive={setupGateActive}
          />
        );
      case "pairing":
        return (
          <OperatorPageGuard {...operatorCore} render={(core) => <PairingPage core={core} />} />
        );
      case "permissions":
        return <Permissions />;
      case "settings":
        return (
          <OperatorPageGuard
            {...operatorCore}
            render={(core) => <SettingsPage core={core} mode="desktop" />}
          />
        );
      case "debug":
        return <DebugPage />;
    }
  };

  const content = (
    <Layout
      currentPage={effectivePage}
      onNavigate={handleNavigate}
      connectionStatus={connectionStatus}
    >
      {renderPage()}
      <ConsentModal />
    </Layout>
  );

  return <ToastProvider>{content}</ToastProvider>;
}
