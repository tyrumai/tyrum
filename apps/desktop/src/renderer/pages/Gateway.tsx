import { Alert, OperatorUiApp } from "@tyrum/operator-ui";
import type { DesktopOperatorCoreState } from "../lib/desktop-operator-core.js";

export type GatewayProps = DesktopOperatorCoreState;

export function Gateway({ core, busy, errorMessage }: GatewayProps) {
  const api = window.tyrumDesktop;

  if (!api) {
    return (
      <div className="grid gap-4 px-4 py-6">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Gateway</h1>
        <Alert variant="error" title="Desktop API not available." />
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="grid gap-4 px-4 py-6">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Gateway</h1>
        <Alert variant="error" title="Error" description={errorMessage} />
      </div>
    );
  }

  if (!core) {
    return (
      <div className="grid gap-4 px-4 py-6">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Gateway</h1>
        <Alert
          variant="warning"
          title={busy ? "Loading operator UI..." : "Operator UI not ready."}
        />
      </div>
    );
  }

  return <OperatorUiApp core={core} mode="desktop" />;
}
