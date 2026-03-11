import React from "react";
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
import { useMobileNode } from "./use-mobile-node.js";
import { useMobileOperatorCore } from "./use-mobile-operator-core.js";

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
  const bootstrap = operator.bootstrap;
  const connectionConfig = operator.bootstrap
    ? {
        httpBaseUrl: operator.bootstrap.httpBaseUrl,
        wsUrl: operator.bootstrap.wsUrl,
        nodeEnabled: operator.bootstrap.nodeEnabled,
        actionSettings: operator.bootstrap.actionSettings,
      }
    : null;
  const mobileNode = useMobileNode({
    config: connectionConfig,
    token: operator.bootstrap?.token ?? null,
    updateConfig: operator.updateConfig,
  });

  if (operator.busy && !operator.bootstrap && !operator.core) {
    return <LoadingScreen label="Loading Tyrum Mobile…" />;
  }

  if (!bootstrap) {
    return <MobileSetupPage onSubmit={operator.saveConfig} busy={operator.busy} />;
  }

  if (!operator.core || !operator.elevatedModeController) {
    if (operator.busy) {
      return <LoadingScreen label="Connecting to the Tyrum gateway…" />;
    }

    if (operator.errorMessage) {
      return (
        <MobileSetupPage
          initialConfig={bootstrap}
          errorMessage={operator.errorMessage}
          onSubmit={operator.saveConfig}
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
            httpBaseUrl: httpUrl.trim().replace(/\/+$/, ""),
            wsUrl: wsUrl.trim(),
          });
        }}
      />
    </OperatorUiHostProvider>
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
