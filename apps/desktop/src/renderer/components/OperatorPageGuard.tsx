import type { ReactNode } from "react";
import {
  ElevatedModeProvider,
  Alert,
  Button,
  Spinner,
  type OperatorCore,
} from "@tyrum/operator-ui";
import type { DesktopOperatorCoreState } from "../lib/desktop-operator-core.js";

interface OperatorPageGuardProps extends DesktopOperatorCoreState {
  render: (core: OperatorCore) => ReactNode;
}

export function OperatorPageGuard({
  core,
  busy,
  errorMessage,
  retry,
  render,
}: OperatorPageGuardProps) {
  if (!window.tyrumDesktop) {
    return <Alert variant="error" title="Desktop API not available." />;
  }

  if (errorMessage) {
    return (
      <div className="grid gap-4">
        <Alert variant="error" title="Error" description={errorMessage} />
        <div>
          <Button variant="secondary" onClick={retry}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!core) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12">
        <Spinner className="h-6 w-6 text-fg-muted" />
        <span className="text-sm text-fg-muted">
          {busy ? "Loading..." : "Waiting for operator connection..."}
        </span>
      </div>
    );
  }

  return (
    <ElevatedModeProvider core={core} mode="desktop">
      {render(core)}
    </ElevatedModeProvider>
  );
}
