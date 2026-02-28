import { OperatorUiApp } from "@tyrum/operator-ui";
import type { DesktopOperatorCoreState } from "../lib/desktop-operator-core.js";
import { colors } from "../theme.js";

export type GatewayProps = DesktopOperatorCoreState;

export function Gateway({ core, busy, errorMessage }: GatewayProps) {
  const api = window.tyrumDesktop;

  if (!api) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Gateway</h1>
        <div>Desktop API not available.</div>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Gateway</h1>
        <div style={{ marginTop: 12, color: colors.error }}>{errorMessage}</div>
      </div>
    );
  }

  if (!core) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Gateway</h1>
        <div>{busy ? "Loading operator UI..." : "Operator UI not ready."}</div>
      </div>
    );
  }

  return <OperatorUiApp core={core} mode="desktop" />;
}
