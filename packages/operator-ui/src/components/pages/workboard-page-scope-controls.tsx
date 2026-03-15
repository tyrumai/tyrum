import type { OperatorCore, WorkboardScopeKeys } from "@tyrum/operator-core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Select } from "../ui/select.js";
import { StatusDot, type StatusDotVariant } from "../ui/status-dot.js";

type WorkboardScopeControlsProps = {
  core: OperatorCore;
  isConnected: boolean;
  scopeKeys: WorkboardScopeKeys;
};

type WorkboardToolbarActionsProps = WorkboardScopeControlsProps & {
  connectionStatus: string;
};

type AgentOption = {
  agentKey: string;
  label: string;
};

const DEFAULT_SCOPE_KEYS: WorkboardScopeKeys = {
  agent_key: "default",
  workspace_key: "default",
} as const;

function normalizeScopeKeys(scopeKeys: Partial<WorkboardScopeKeys>): WorkboardScopeKeys {
  return {
    agent_key: scopeKeys.agent_key?.trim() || DEFAULT_SCOPE_KEYS.agent_key,
    workspace_key: scopeKeys.workspace_key?.trim() || DEFAULT_SCOPE_KEYS.workspace_key,
  };
}

function normalizeAgentOptions(agents: unknown): AgentOption[] {
  if (!Array.isArray(agents)) {
    return [];
  }

  const seen = new Set<string>();
  const options: AgentOption[] = [];
  for (const agent of agents) {
    if (!agent || typeof agent !== "object") {
      continue;
    }
    const record = agent as { agent_key?: unknown; persona?: { name?: unknown } | null };
    const agentKey =
      typeof record.agent_key === "string" && record.agent_key.trim().length > 0
        ? record.agent_key.trim()
        : "";
    if (!agentKey || seen.has(agentKey)) {
      continue;
    }
    seen.add(agentKey);
    const personaName =
      typeof record.persona?.name === "string" && record.persona.name.trim().length > 0
        ? record.persona.name.trim()
        : "";
    options.push({
      agentKey,
      label:
        personaName && personaName.toLowerCase() !== agentKey.toLowerCase()
          ? `${agentKey} · ${personaName}`
          : agentKey,
    });
  }
  options.sort((left, right) => left.agentKey.localeCompare(right.agentKey));
  return options;
}

export function WorkboardScopeControls({
  core,
  isConnected,
  scopeKeys,
}: WorkboardScopeControlsProps) {
  const [scopeDraft, setScopeDraft] = useState<WorkboardScopeKeys>(scopeKeys);
  const [agentOptions, setAgentOptions] = useState<AgentOption[]>([]);

  useEffect(() => {
    setScopeDraft(scopeKeys);
  }, [scopeKeys]);

  useEffect(() => {
    let cancelled = false;

    const loadAgentOptions = async (): Promise<void> => {
      try {
        const response = await core.http.agents.list();
        if (cancelled) return;
        setAgentOptions(normalizeAgentOptions((response as { agents?: unknown })?.agents));
      } catch {
        if (!cancelled) {
          setAgentOptions([]);
        }
      }
    };

    void loadAgentOptions();

    return () => {
      cancelled = true;
    };
  }, [core.http]);

  const visibleAgentOptions = useMemo(() => {
    if (agentOptions.some((option) => option.agentKey === scopeDraft.agent_key)) {
      return agentOptions;
    }
    return [{ agentKey: scopeDraft.agent_key, label: scopeDraft.agent_key }, ...agentOptions];
  }, [agentOptions, scopeDraft.agent_key]);

  const applyScope = useCallback(async (): Promise<void> => {
    const nextScopeKeys = normalizeScopeKeys(scopeDraft);
    core.workboardStore.setScopeKeys(nextScopeKeys);
    if (!isConnected) return;
    await core.workboardStore.refreshList();
  }, [core.workboardStore, isConnected, scopeDraft]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select
        data-testid="workboard-scope-agent"
        aria-label="Workboard agent scope"
        className="min-w-44"
        value={scopeDraft.agent_key}
        onChange={(event) =>
          setScopeDraft((prev) => ({ ...prev, agent_key: event.currentTarget.value }))
        }
      >
        {visibleAgentOptions.map((option) => (
          <option key={option.agentKey} value={option.agentKey}>
            {option.label}
          </option>
        ))}
      </Select>
      <Input
        data-testid="workboard-scope-workspace"
        aria-label="Workboard workspace scope"
        className="w-36"
        value={scopeDraft.workspace_key}
        onChange={(event) =>
          setScopeDraft((prev) => ({ ...prev, workspace_key: event.currentTarget.value }))
        }
      />
      <Button
        data-testid="workboard-scope-apply"
        variant="secondary"
        size="sm"
        onClick={() => {
          void applyScope();
        }}
      >
        Load scope
      </Button>
    </div>
  );
}

export function WorkboardToolbarActions({
  connectionStatus,
  core,
  isConnected,
  scopeKeys,
}: WorkboardToolbarActionsProps) {
  const connectionDotVariant: StatusDotVariant =
    connectionStatus === "connected"
      ? "success"
      : connectionStatus === "connecting"
        ? "warning"
        : "neutral";

  return (
    <>
      <WorkboardScopeControls core={core} isConnected={isConnected} scopeKeys={scopeKeys} />
      <div className="flex items-center gap-2 text-sm text-fg-muted">
        <StatusDot variant={connectionDotVariant} pulse={connectionStatus === "connecting"} />
        {connectionStatus}
      </div>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          core.disconnect();
          core.connect();
        }}
      >
        Reconnect
      </Button>
    </>
  );
}
