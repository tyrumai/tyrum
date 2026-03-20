import type { OperatorCore, WorkboardScopeKeys } from "@tyrum/operator-app";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../ui/button.js";
import { Select } from "../ui/select.js";

type WorkboardScopeControlsProps = {
  core: OperatorCore;
  isConnected: boolean;
  scopeKeys: WorkboardScopeKeys;
};

type AgentOption = {
  agentKey: string;
  label: string;
};

const DEFAULT_SCOPE_KEYS: WorkboardScopeKeys = {
  agent_key: "default",
  workspace_key: "default",
} as const;

function normalizeAgentKey(agentKey?: string): string {
  return agentKey?.trim() || DEFAULT_SCOPE_KEYS.agent_key;
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
      label: personaName || agentKey,
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
  const [agentKeyDraft, setAgentKeyDraft] = useState(() => normalizeAgentKey(scopeKeys.agent_key));
  const [agentOptions, setAgentOptions] = useState<AgentOption[]>([]);

  useEffect(() => {
    setAgentKeyDraft(normalizeAgentKey(scopeKeys.agent_key));
  }, [scopeKeys.agent_key]);

  useEffect(() => {
    let cancelled = false;

    const loadAgentOptions = async (): Promise<void> => {
      try {
        const response = await core.admin.agents.list();
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
  }, [core.admin]);

  const visibleAgentOptions = useMemo(() => {
    if (agentOptions.some((option) => option.agentKey === agentKeyDraft)) {
      return agentOptions;
    }
    return [{ agentKey: agentKeyDraft, label: agentKeyDraft }, ...agentOptions];
  }, [agentKeyDraft, agentOptions]);

  const applyScope = useCallback(async (): Promise<void> => {
    const nextScopeKeys = {
      agent_key: normalizeAgentKey(agentKeyDraft),
      workspace_key: scopeKeys.workspace_key,
    } satisfies WorkboardScopeKeys;
    core.workboardStore.setScopeKeys(nextScopeKeys);
    if (!isConnected) return;
    await core.workboardStore.refreshList();
  }, [agentKeyDraft, core.workboardStore, isConnected, scopeKeys.workspace_key]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select
        data-testid="workboard-scope-agent"
        aria-label="Workboard agent scope"
        className="min-w-44"
        value={agentKeyDraft}
        onChange={(event) => {
          setAgentKeyDraft(event.currentTarget.value);
        }}
      >
        {visibleAgentOptions.map((option) => (
          <option key={option.agentKey} value={option.agentKey}>
            {option.label}
          </option>
        ))}
      </Select>
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

export function WorkboardToolbarActions(props: WorkboardScopeControlsProps) {
  return <WorkboardScopeControls {...props} />;
}
