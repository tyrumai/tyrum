import { MemoryInspector } from "@tyrum/operator-ui";
import type { DesktopOperatorCoreState } from "../lib/desktop-operator-core.js";
import { colors } from "../theme.js";

export type MemoryProps = DesktopOperatorCoreState;

export function Memory({ core, busy, errorMessage }: MemoryProps) {
  const api = window.tyrumDesktop;

  if (!api) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Memory</h1>
        <div>Desktop API not available.</div>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Memory</h1>
        <div style={{ marginTop: 12, color: colors.error }}>{errorMessage}</div>
      </div>
    );
  }

  if (!core) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Memory</h1>
        <div>{busy ? "Loading memory..." : "Memory inspector not ready."}</div>
      </div>
    );
  }

  return <MemoryInspector core={core} />;
}
