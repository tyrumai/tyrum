import type { OperatorCore } from "@tyrum/operator-app";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { AdminAccessProvider } from "./elevated-mode.js";
import { ErrorBoundary } from "./components/error/error-boundary.js";
import { AppShell } from "./components/layout/app-shell.js";
import { MobileNav } from "./components/layout/mobile-nav.js";
import { Sidebar } from "./components/layout/sidebar.js";
import { ScrollArea } from "./components/ui/scroll-area.js";
import { Spinner } from "./components/ui/spinner.js";
import { ToastProvider } from "./components/toast/toast-provider.js";
import { AdminAccessModeProvider } from "./hooks/use-admin-access-mode.js";
import { ThemeProvider, useThemeOptional } from "./hooks/use-theme.js";
import type { DesktopApi } from "./desktop-api.js";
import { OperatorUiHostProvider, useHostApiOptional, type HostKind } from "./host/host-api.js";
import { LocalNodeAutoApprovalBridge } from "./local-node-auto-approval.js";
import { CONNECT_PAGE_RENDER, getOperatorRouteDefinition } from "./operator-routes.js";
import { RetainedUiStateProvider } from "./reconnect-ui-state.js";
import { useOperatorAppViewModel } from "./use-operator-app-view-model.js";
import type { AdminAccessController } from "./elevated-mode.js";
import type { WebAuthPersistence } from "./web-auth.js";
import type { AgentsPageNavigationIntent } from "./components/pages/agents-page.lib.js";
import {
  FirstRunOnboardingPage,
  useFirstRunOnboardingController,
} from "./components/pages/first-run-onboarding.js";

export type OperatorUiMode = "web" | "desktop";

export interface OperatorUiAppProps {
  core: OperatorCore;
  mode: OperatorUiMode;
  adminAccessController?: AdminAccessController;
  onReloadPage?: () => void;
  onReconfigureGateway?: (httpUrl: string, wsUrl: string) => void;
  webAuthPersistence?: WebAuthPersistence;
}

const coreInstanceIds = new WeakMap<object, number>();
let nextCoreInstanceId = 1;

function getCoreInstanceId(core: OperatorCore): number {
  const coreObject = core as object;
  const existing = coreInstanceIds.get(coreObject);
  if (existing !== undefined) {
    return existing;
  }
  const created = nextCoreInstanceId++;
  coreInstanceIds.set(coreObject, created);
  return created;
}

export function OperatorUiApp({
  core,
  mode,
  adminAccessController,
  onReloadPage,
  onReconfigureGateway,
  webAuthPersistence,
}: OperatorUiAppProps) {
  return (
    <ErrorBoundary onReloadPage={onReloadPage}>
      <OperatorUiAppHostBoundary mode={mode}>
        <OperatorUiAppRoot
          core={core}
          mode={mode}
          adminAccessController={adminAccessController}
          onReloadPage={onReloadPage}
          onReconfigureGateway={onReconfigureGateway}
          webAuthPersistence={webAuthPersistence}
        />
      </OperatorUiAppHostBoundary>
    </ErrorBoundary>
  );
}

function OperatorUiAppHostBoundary({
  mode,
  children,
}: {
  mode: OperatorUiMode;
  children: ReactNode;
}) {
  const existing = useHostApiOptional();
  if (existing) return children;
  const value =
    mode === "desktop" ? { kind: "desktop" as const, api: null } : { kind: "web" as const };
  return <OperatorUiHostProvider value={value}>{children}</OperatorUiHostProvider>;
}

function OperatorUiAppRoot({
  core,
  mode,
  adminAccessController,
  onReloadPage,
  onReconfigureGateway,
  webAuthPersistence,
}: Pick<
  OperatorUiAppProps,
  | "core"
  | "mode"
  | "adminAccessController"
  | "onReloadPage"
  | "onReconfigureGateway"
  | "webAuthPersistence"
>) {
  const existingTheme = useThemeOptional();
  const host = useHostApiOptional();
  const hostKind: HostKind = host?.kind ?? (mode === "desktop" ? "desktop" : "web");
  const reconnectUiScopeKey = `${mode}:${core.httpBaseUrl}:${core.deviceId ?? ""}`;
  const onboarding = useFirstRunOnboardingController({
    core,
    hostKind,
    scopeKey: reconnectUiScopeKey,
  });
  const viewModel = useOperatorAppViewModel({
    core,
    mode,
    hostKind,
    navigationLocked: onboarding.isOpen,
    onNavigationRequest:
      (host?.kind === "desktop" || host?.kind === "mobile") && host.api?.onNavigationRequest
        ? host.api.onNavigationRequest
        : undefined,
  });
  useDesktopNodeAutoConnection({
    connection: viewModel.connection,
    hostKind,
    hostApi: host?.kind === "desktop" ? host.api : null,
  });
  const routeDefinition = getOperatorRouteDefinition(viewModel.route);
  const chatRouteDefinition = getOperatorRouteDefinition("chat");
  const navigationBlocked = onboarding.isOpen;
  const [retainChatRoute, setRetainChatRoute] = useState(viewModel.route === "chat");
  const [agentsNavigationIntent, setAgentsNavigationIntent] =
    useState<AgentsPageNavigationIntent | null>(null);
  const chatHostKey = `${reconnectUiScopeKey}:${getCoreInstanceId(core)}`;
  const previousReconnectUiScopeKey = useRef(reconnectUiScopeKey);

  useEffect(() => {
    if (viewModel.route === "chat") {
      setRetainChatRoute(true);
    }
  }, [viewModel.route]);

  useEffect(() => {
    if (previousReconnectUiScopeKey.current === reconnectUiScopeKey) {
      return;
    }
    previousReconnectUiScopeKey.current = reconnectUiScopeKey;
    setRetainChatRoute(false);
  }, [reconnectUiScopeKey]);

  useEffect(() => {
    if (viewModel.showConnectPage || onboarding.isOpen) {
      setRetainChatRoute(false);
    }
  }, [onboarding.isOpen, viewModel.showConnectPage]);

  const routeRenderContext = {
    core,
    mode,
    hostKind,
    navigate: viewModel.navigate,
    onOpenAgentRun: (intent: AgentsPageNavigationIntent) => {
      setAgentsNavigationIntent(intent);
      if (viewModel.route !== "agents") {
        viewModel.navigate("agents");
      }
    },
    agentsNavigationIntent,
    onAgentsNavigationIntentHandled: () => {
      setAgentsNavigationIntent(null);
    },
    onboardingAvailable: onboarding.available,
    onOpenOnboarding: onboarding.open,
    onReloadPage,
    onReconfigureGateway,
    webAuthPersistence,
    initialConfigureTab: viewModel.initialConfigureTab,
    onConfigureTabChange: (tab: string) => viewModel.replaceRoute("configure", tab),
  } as const;
  const showRetainedChat =
    chatRouteDefinition &&
    !viewModel.showConnectPage &&
    !onboarding.isOpen &&
    (retainChatRoute || viewModel.route === "chat");

  const shell = (
    <AppShell
      mode={mode}
      fullBleed={true}
      viewportLocked={true}
      sidebar={
        viewModel.showShell && !navigationBlocked ? (
          <Sidebar
            items={viewModel.sidebarItems}
            groups={viewModel.sidebarGroups}
            secondaryItems={viewModel.platformItems}
            secondaryLabel="This Device"
            activeItemId={viewModel.route}
            onNavigate={viewModel.navigate}
            collapsible
            connectionStatus={viewModel.connection.status}
            onConnectionClick={() => {
              viewModel.navigate(
                hostKind === "desktop" ? "desktop" : hostKind === "mobile" ? "mobile" : "configure",
              );
            }}
            onSyncNow={() => {
              void core.syncAllNow();
            }}
            syncNowDisabled={viewModel.connection.status !== "connected"}
            syncNowLoading={viewModel.autoSync.isSyncing}
          />
        ) : null
      }
      mobileNav={
        viewModel.showShell && !navigationBlocked ? (
          <MobileNav
            items={viewModel.mobileItems}
            overflowItems={viewModel.mobileOverflowItems}
            overflowGroups={viewModel.mobileOverflowGroups}
            activeItemId={viewModel.route}
            onNavigate={viewModel.navigate}
          />
        ) : null
      }
    >
      <RetainedUiStateProvider scopeKey={reconnectUiScopeKey}>
        <AdminAccessModeProvider>
          <AdminAccessProvider
            core={core}
            mode={mode}
            adminAccessController={adminAccessController}
          >
            <LocalNodeAutoApprovalBridge />
            {viewModel.showConnectPage ? (
              <div className="flex min-h-0 flex-1 overflow-hidden">
                <ScrollArea className="h-full w-full">
                  <div className="mx-auto flex min-h-full w-full max-w-lg items-start px-4 py-6 md:items-center md:py-10">
                    <Suspense fallback={<OperatorRouteFallback />}>
                      {CONNECT_PAGE_RENDER(routeRenderContext)}
                    </Suspense>
                  </div>
                </ScrollArea>
              </div>
            ) : onboarding.isOpen ? (
              <FirstRunOnboardingPage
                core={core}
                onClose={onboarding.close}
                onSkip={onboarding.skip}
                onMarkCompleted={onboarding.markCompleted}
                onNavigate={(routeId) => {
                  viewModel.navigate(routeId);
                }}
              />
            ) : (
              <Suspense fallback={<OperatorRouteFallback />}>
                <>
                  {showRetainedChat ? (
                    <div
                      key={chatHostKey}
                      className={viewModel.route === "chat" ? "contents" : "hidden"}
                      data-testid="retained-chat-route"
                      aria-hidden={viewModel.route === "chat" ? undefined : true}
                    >
                      {chatRouteDefinition.render(routeRenderContext)}
                    </div>
                  ) : null}
                  {viewModel.route === "chat"
                    ? null
                    : (routeDefinition?.render(routeRenderContext) ?? null)}
                </>
              </Suspense>
            )}
          </AdminAccessProvider>
        </AdminAccessModeProvider>
      </RetainedUiStateProvider>
    </AppShell>
  );

  const app = <ToastProvider>{shell}</ToastProvider>;

  return existingTheme ? app : <ThemeProvider>{app}</ThemeProvider>;
}

function OperatorRouteFallback() {
  return (
    <div className="flex min-h-[220px] items-center justify-center">
      <Spinner className="h-5 w-5" />
    </div>
  );
}

function useDesktopNodeAutoConnection({
  connection,
  hostKind,
  hostApi,
}: {
  connection: { status: "disconnected" | "connecting" | "connected"; recovering: boolean };
  hostKind: HostKind;
  hostApi: DesktopApi | null;
}) {
  const nodeLinkedRef = useRef(false);

  useEffect(() => {
    if (hostKind !== "desktop" || !hostApi) {
      nodeLinkedRef.current = false;
      return;
    }

    if (connection.status === "connected") {
      if (nodeLinkedRef.current) return;
      nodeLinkedRef.current = true;
      void hostApi.node
        .connect()
        .then((result) => {
          if (result.status === "disconnected") {
            nodeLinkedRef.current = false;
          }
        })
        .catch(() => {
          nodeLinkedRef.current = false;
        });
      return;
    }

    if (connection.status === "disconnected" && !connection.recovering && nodeLinkedRef.current) {
      nodeLinkedRef.current = false;
      void hostApi.node.disconnect().catch(() => {
        // Keep local node lifecycle best-effort and avoid surfacing background disconnect errors.
      });
    }
  }, [connection.recovering, connection.status, hostApi, hostKind]);

  useEffect(() => {
    if (hostKind !== "desktop" || !hostApi) return;
    return () => {
      if (!nodeLinkedRef.current) return;
      nodeLinkedRef.current = false;
      void hostApi.node.disconnect().catch(() => {
        // Ignore disconnect failures during teardown/rebootstrap.
      });
    };
  }, [hostApi, hostKind]);
}
