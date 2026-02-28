import { MemoryInspector } from "@tyrum/operator-ui";
import { useDesktopOperatorCore } from "../lib/desktop-operator-core.js";
import { colors } from "../theme.js";

export function Memory() {
  const api = window.tyrumDesktop;
  const { core, busy, errorMessage } = useDesktopOperatorCore();

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

