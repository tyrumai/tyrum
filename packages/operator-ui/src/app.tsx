import type { OperatorCore } from "@tyrum/operator-core";
import { Suspense, useEffect, useRef, type ReactNode } from "react";
import { AdminAccessProvider } from "./elevated-mode.js";
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
import { RetainedUiStateProvider } from "./reconnect-ui-state.js";
import { useOperatorAppViewModel } from "./use-operator-app-view-model.js";
import type { AdminAccessController } from "./elevated-mode.js";
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
}

export function OperatorUiApp({
  core,
  mode,
  adminAccessController,
  onReloadPage,
  onReconfigureGateway,
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
  adminAccessController,
  onReloadPage,
  onReconfigureGateway,
}: Pick<
  OperatorUiAppProps,
  "core" | "mode" | "adminAccessController" | "onReloadPage" | "onReconfigureGateway"
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
  const navigationBlocked = onboarding.isOpen;

  const shell = (
    <AppShell
      mode={mode}
      fullBleed={true}
      viewportLocked={true}
      sidebar={
        viewModel.showShell && !navigationBlocked ? (
          <Sidebar
            items={viewModel.sidebarItems}
            secondaryItems={viewModel.platformItems}
            secondaryLabel="Node"
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
            activeItemId={viewModel.route}
            onNavigate={viewModel.navigate}
          />
        ) : null
      }
    >
      <RetainedUiStateProvider scopeKey={reconnectUiScopeKey}>
        <AdminAccessProvider core={core} mode={mode} adminAccessController={adminAccessController}>
          {viewModel.showConnectPage ? (
            <div className="flex min-h-0 flex-1 overflow-hidden">
              <ScrollArea className="h-full w-full">
                <div className="mx-auto flex min-h-full w-full max-w-lg items-start px-4 py-6 md:items-center md:py-10">
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
              {routeDefinition?.render({
                core,
                mode,
                hostKind,
                navigate: viewModel.navigate,
                onboardingAvailable: onboarding.available,
                onOpenOnboarding: onboarding.open,
                onReloadPage,
                onReconfigureGateway,
              }) ?? null}
            </Suspense>
          )}
        </AdminAccessProvider>
      </RetainedUiStateProvider>
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
