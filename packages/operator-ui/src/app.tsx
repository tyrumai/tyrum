import type { OperatorCore } from "@tyrum/operator-core";
import { Suspense, useEffect, useRef, type ReactNode } from "react";
import { ElevatedModeProvider } from "./elevated-mode.js";
import { ErrorBoundary } from "./components/error/error-boundary.js";
import { AppShell } from "./components/layout/app-shell.js";
import { MobileNav } from "./components/layout/mobile-nav.js";
import { Sidebar } from "./components/layout/sidebar.js";
import { ScrollArea } from "./components/ui/scroll-area.js";
import { Spinner } from "./components/ui/spinner.js";
import { ToastProvider } from "./components/toast/toast-provider.js";
import { ThemeProvider, useThemeOptional } from "./hooks/use-theme.js";
import { BrowserNodeProvider } from "./browser-node/browser-node-provider.js";
import { getDesktopApi } from "./desktop-api.js";
import { OperatorUiHostProvider, useHostApiOptional, type HostKind } from "./host/host-api.js";
import { CONNECT_PAGE_RENDER, getOperatorRouteDefinition } from "./operator-routes.js";
import { useOperatorAppViewModel } from "./use-operator-app-view-model.js";
import type { ElevatedModeController } from "./components/elevated-mode/elevated-mode-controller.js";

export type OperatorUiMode = "web" | "desktop";

export interface OperatorUiAppProps {
  core: OperatorCore;
  mode: OperatorUiMode;
  elevatedModeController?: ElevatedModeController;
  onReloadPage?: () => void;
  onReconfigureGateway?: (httpUrl: string, wsUrl: string) => void;
}

export function OperatorUiApp({
  core,
  mode,
  elevatedModeController,
  onReloadPage,
  onReconfigureGateway,
}: OperatorUiAppProps) {
  return (
    <ErrorBoundary onReloadPage={onReloadPage}>
      <OperatorUiAppHostBoundary mode={mode}>
        <OperatorUiAppRoot
          core={core}
          mode={mode}
          elevatedModeController={elevatedModeController}
          onReloadPage={onReloadPage}
          onReconfigureGateway={onReconfigureGateway}
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
    mode === "desktop"
      ? { kind: "desktop" as const, api: getDesktopApi() }
      : { kind: "web" as const };
  return <OperatorUiHostProvider value={value}>{children}</OperatorUiHostProvider>;
}

function OperatorUiAppRoot({
  core,
  mode,
  elevatedModeController,
  onReloadPage,
  onReconfigureGateway,
}: Pick<
  OperatorUiAppProps,
  "core" | "mode" | "elevatedModeController" | "onReloadPage" | "onReconfigureGateway"
>) {
  const existingTheme = useThemeOptional();
  const host = useHostApiOptional();
  const hostKind: HostKind = host?.kind ?? (mode === "desktop" ? "desktop" : "web");
  const viewModel = useOperatorAppViewModel({
    core,
    mode,
    hostKind,
    onNavigationRequest:
      host?.kind === "desktop" && host.api?.onNavigationRequest
        ? host.api.onNavigationRequest
        : undefined,
  });
  useDesktopNodeAutoConnection({
    connection: viewModel.connection,
    hostKind,
    hostApi: host?.kind === "desktop" ? host.api : null,
  });
  const routeDefinition = getOperatorRouteDefinition(viewModel.route);

  const shell = (
    <AppShell
      mode={mode}
      fullBleed={true}
      viewportLocked={true}
      sidebar={
        viewModel.showShell ? (
          <Sidebar
            items={viewModel.sidebarItems}
            secondaryItems={viewModel.platformItems}
            secondaryLabel="Node"
            activeItemId={viewModel.route}
            onNavigate={viewModel.navigate}
            collapsible
            connectionStatus={viewModel.connection.status}
            onConnectionClick={() => {
              viewModel.navigate(hostKind === "desktop" ? "desktop" : "configure");
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
        viewModel.showShell ? (
          <MobileNav
            items={viewModel.mobileItems}
            overflowItems={viewModel.mobileOverflowItems}
            activeItemId={viewModel.route}
            onNavigate={viewModel.navigate}
          />
        ) : null
      }
    >
      <ElevatedModeProvider core={core} mode={mode} elevatedModeController={elevatedModeController}>
        {viewModel.showConnectPage ? (
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <ScrollArea className="h-full w-full">
              <div className="mx-auto flex min-h-full w-full max-w-md items-start px-4 py-6 md:items-center md:py-10">
                <Suspense fallback={<OperatorRouteFallback />}>
                  {CONNECT_PAGE_RENDER({
                    core,
                    mode,
                    hostKind,
                    navigate: viewModel.navigate,
                    onReloadPage,
                    onReconfigureGateway,
                  })}
                </Suspense>
              </div>
            </ScrollArea>
          </div>
        ) : (
          <Suspense fallback={<OperatorRouteFallback />}>
            {routeDefinition?.render({
              core,
              mode,
              hostKind,
              navigate: viewModel.navigate,
              onReloadPage,
              onReconfigureGateway,
            }) ?? null}
          </Suspense>
        )}
      </ElevatedModeProvider>
    </AppShell>
  );

  const app = (
    <ToastProvider>
      {hostKind === "web" ? (
        <BrowserNodeProvider wsUrl={core.wsUrl}>{shell}</BrowserNodeProvider>
      ) : (
        shell
      )}
    </ToastProvider>
  );

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
  hostApi: ReturnType<typeof getDesktopApi> | null;
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
