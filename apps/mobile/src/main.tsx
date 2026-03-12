import React, { useMemo } from "react";
import { createRoot } from "react-dom/client";
import {
  Alert,
  Button,
  Card,
  CardContent,
  OperatorUiApp,
  OperatorUiHostProvider,
  Spinner,
} from "@tyrum/operator-ui";
import "@tyrum/operator-ui/globals.css";
import { MobileSetupPage } from "./mobile-setup-page.js";
import { normalizeHttpBaseUrl, sameMobileBootstrapConfig } from "./mobile-config.js";
import { useMobileBootstrapIntents } from "./use-mobile-bootstrap-intents.js";
import { useMobileNode } from "./use-mobile-node.js";
import { useMobileOperatorCore } from "./use-mobile-operator-core.js";
import { useMobileRuntimeSignals } from "./use-mobile-runtime-signals.js";

function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 text-fg">
      <Card className="w-full max-w-md">
        <CardContent className="flex items-center gap-3 pt-6">
          <Spinner className="h-5 w-5" />
          <div className="text-sm">{label}</div>
        </CardContent>
      </Card>
    </div>
  );
}

function ErrorScreen({
  errorMessage,
  onRetry,
  onReset,
}: {
  errorMessage: string;
  onRetry: () => void;
  onReset: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 text-fg">
      <Card className="w-full max-w-lg">
        <CardContent className="grid gap-4 pt-6">
          <Alert variant="error" title="Mobile app bootstrap failed" description={errorMessage} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onReset}>
              Reset config
            </Button>
            <Button onClick={onRetry}>Retry</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MobileRoot() {
  const operator = useMobileOperatorCore();
  const bootstrapIntents = useMobileBootstrapIntents();
  const bootstrap = operator.bootstrap;
  const connectionConfig = useMemo(
    () =>
      bootstrap
        ? {
            httpBaseUrl: bootstrap.httpBaseUrl,
            wsUrl: bootstrap.wsUrl,
            nodeEnabled: bootstrap.nodeEnabled,
            actionSettings: bootstrap.actionSettings,
          }
        : null,
    [bootstrap],
  );
  const mobileNode = useMobileNode({
    config: connectionConfig,
    token: operator.bootstrap?.token ?? null,
    updateConfig: operator.updateConfig,
  });
  const reconnectConnections = () => {
    const operatorConnection = operator.core?.connectionStore.getSnapshot();
    if (operator.bootstrap && operator.core && operatorConnection?.status === "disconnected") {
      operator.core.connect();
    } else if (operator.bootstrap && !operator.busy && !operator.core) {
      operator.retry();
    }

    if (mobileNode.state.enabled && mobileNode.state.status === "disconnected") {
      mobileNode.retry();
    }
  };
  const runtimeSignals = useMobileRuntimeSignals(reconnectConnections);
  const setupDraft = bootstrapIntents.draftConfig;
  const runtimeAlerts = (
    <>
      {runtimeSignals.networkStatus && !runtimeSignals.networkStatus.connected ? (
        <Alert
          variant="warning"
          title="Network unavailable"
          description="Tyrum Mobile will reconnect automatically when the device is back online."
        />
      ) : null}
      {bootstrapIntents.errorMessage && !setupDraft ? (
        <Alert
          variant="error"
          title="Bootstrap import failed"
          description={bootstrapIntents.errorMessage}
        />
      ) : null}
    </>
  );

  if (operator.busy && !operator.bootstrap && !operator.core) {
    return <LoadingScreen label="Loading Tyrum Mobile…" />;
  }

  if (!bootstrap || setupDraft) {
    const initialSetupConfig = setupDraft ?? bootstrap;
    const existingConfig =
      bootstrap && setupDraft && !sameMobileBootstrapConfig(bootstrap, setupDraft)
        ? bootstrap
        : null;

    return (
      <MobileSetupPage
        initialConfig={initialSetupConfig}
        existingConfig={existingConfig}
        intentMessage={bootstrapIntents.noticeMessage}
        intentErrorMessage={bootstrapIntents.errorMessage}
        onSubmit={async (config) => {
          await operator.saveConfig(config);
          bootstrapIntents.clearDraft();
        }}
        onCancel={setupDraft ? bootstrapIntents.clearDraft : undefined}
        onScanQr={bootstrapIntents.scanQrCode}
        scanQrAvailable={bootstrapIntents.canScanQr}
        scanQrBusy={bootstrapIntents.scanBusy}
        busy={operator.busy}
      />
    );
  }

  if (!operator.core || !operator.elevatedModeController) {
    if (operator.busy) {
      return <LoadingScreen label="Connecting to the Tyrum gateway…" />;
    }

    if (operator.errorMessage) {
      return (
        <MobileSetupPage
          initialConfig={bootstrap}
          intentErrorMessage={bootstrapIntents.errorMessage}
          errorMessage={operator.errorMessage}
          onSubmit={operator.saveConfig}
          onScanQr={bootstrapIntents.scanQrCode}
          scanQrAvailable={bootstrapIntents.canScanQr}
          scanQrBusy={bootstrapIntents.scanBusy}
        />
      );
    }

    return (
      <ErrorScreen
        errorMessage="Operator core is unavailable."
        onRetry={operator.retry}
        onReset={() => {
          void operator.clearConfig();
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-bg">
      {runtimeSignals.networkStatus && !runtimeSignals.networkStatus.connected ? (
        <div className="px-4 pt-4">{runtimeAlerts}</div>
      ) : bootstrapIntents.errorMessage ? (
        <div className="px-4 pt-4">{runtimeAlerts}</div>
      ) : null}
      <OperatorUiHostProvider value={{ kind: "mobile", api: mobileNode.hostApi }}>
        <OperatorUiApp
          core={operator.core}
          mode="web"
          elevatedModeController={operator.elevatedModeController}
          onReloadPage={() => {
            globalThis.location.reload();
          }}
          onReconfigureGateway={(httpUrl, wsUrl) => {
            if (!bootstrap) return;
            void operator.saveConfig({
              ...bootstrap,
              httpBaseUrl: normalizeHttpBaseUrl(httpUrl),
              wsUrl: wsUrl.trim(),
            });
          }}
        />
      </OperatorUiHostProvider>
    </div>
  );
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing root element (#root).");
}

createRoot(container).render(
  <React.StrictMode>
    <MobileRoot />
  </React.StrictMode>,
);
