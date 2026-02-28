import type { ReactNode } from "react";
import { MemoryInspector } from "@tyrum/operator-ui";
import type { DesktopOperatorCoreState } from "../lib/desktop-operator-core.js";

export type MemoryProps = DesktopOperatorCoreState;

function MemoryFallback({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold tracking-tight text-fg">Memory</h1>
      {children}
    </div>
  );
}

export function Memory({ core, busy, errorMessage }: MemoryProps) {
  const api = window.tyrumDesktop;

  if (!api) {
    return (
      <MemoryFallback>
        <div>Desktop API not available.</div>
      </MemoryFallback>
    );
  }

  if (errorMessage) {
    return (
      <MemoryFallback>
        <div className="mt-3 text-sm text-error">{errorMessage}</div>
      </MemoryFallback>
    );
  }

  if (!core) {
    return (
      <MemoryFallback>
        <div>{busy ? "Loading memory..." : "Memory inspector not ready."}</div>
      </MemoryFallback>
    );
  }

  return <MemoryInspector core={core} />;
}
