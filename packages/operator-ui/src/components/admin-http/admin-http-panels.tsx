import type { OperatorCore } from "@tyrum/operator-core";
import { AgentStatusPanel } from "./agent-status-panel.js";
import { ArtifactsPanel } from "./artifacts-panel.js";
import { AuditPanel } from "./audit-panel.js";
import { ContextPanel } from "./context-panel.js";
import { HealthPanel } from "./health-panel.js";

export function AdminHttpPanels({ core }: { core: OperatorCore }) {
  return (
    <div className="grid gap-6">
      <AuditPanel core={core} />
      <ContextPanel core={core} />
      <AgentStatusPanel core={core} />
      <ArtifactsPanel core={core} />
      <HealthPanel />
    </div>
  );
}
