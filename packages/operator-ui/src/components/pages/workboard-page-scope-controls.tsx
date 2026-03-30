import type { OperatorCore, WorkboardScopeKeys, WorkboardState } from "@tyrum/operator-app";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "../ui/alert.js";
import { Select } from "../ui/select.js";

type WorkboardScopeControlsProps = {
  core: OperatorCore;
  isConnected: boolean;
  scopeKeys: WorkboardScopeKeys;
  resolvedScope: WorkboardState["resolvedScope"];
};

type AgentOption = {
  agentKey: string;
  agentId: string | null;
  isPrimary: boolean;
  label: string;
};

const DEFAULT_SCOPE_KEYS: WorkboardScopeKeys = {
  agent_key: "",
  workspace_key: "",
} as const;
const IMPLICIT_AGENT_LABEL = "Primary agent";

function normalizeAgentKey(agentKey?: string): string {
  return agentKey?.trim() ?? DEFAULT_SCOPE_KEYS.agent_key;
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
    const record = agent as {
      agent_key?: unknown;
      agent_id?: unknown;
      is_primary?: unknown;
      persona?: { name?: unknown } | null;
    };
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
      agentId:
        typeof record.agent_id === "string" && record.agent_id.trim().length > 0
          ? record.agent_id
          : null,
      isPrimary: record.is_primary === true,
      label: personaName || agentKey,
    });
  }
  options.sort((left, right) => left.agentKey.localeCompare(right.agentKey));
  return options;
}

function buildImplicitAgentOption(params: {
  agentOptions: AgentOption[];
  resolvedScope: WorkboardState["resolvedScope"];
}): AgentOption {
  const resolvedOption = params.resolvedScope?.agent_id
    ? params.agentOptions.find((option) => option.agentId === params.resolvedScope?.agent_id)
    : undefined;
  const primaryOptions = params.agentOptions.filter((option) => option.isPrimary);
  const primaryOption = primaryOptions.length === 1 ? primaryOptions[0] : undefined;
  const activeOption = resolvedOption ?? primaryOption;
  return {
    agentKey: DEFAULT_SCOPE_KEYS.agent_key,
    agentId: activeOption?.agentId ?? null,
    isPrimary: activeOption?.isPrimary ?? false,
    label: activeOption ? `${IMPLICIT_AGENT_LABEL}: ${activeOption.label}` : IMPLICIT_AGENT_LABEL,
  };
}

export function WorkboardScopeControls({
  core,
  isConnected,
  scopeKeys,
  resolvedScope,
}: WorkboardScopeControlsProps) {
  const [agentOptions, setAgentOptions] = useState<AgentOption[]>([]);
  const [agentListError, setAgentListError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadAgentOptions = async (): Promise<void> => {
      setAgentListError(null);
      try {
        const response = await core.admin.agents.list();
        if (cancelled) return;
        setAgentOptions(normalizeAgentOptions((response as { agents?: unknown })?.agents));
      } catch (error) {
        if (!cancelled) {
          setAgentOptions([]);
          setAgentListError(error instanceof Error ? error.message : "Failed to load agent list");
        }
      }
    };

    void loadAgentOptions();

    return () => {
      cancelled = true;
    };
  }, [core.admin]);

  const currentAgentKey = normalizeAgentKey(scopeKeys.agent_key);

  const visibleAgentOptions = useMemo(() => {
    if (!currentAgentKey) {
      return [buildImplicitAgentOption({ agentOptions, resolvedScope }), ...agentOptions];
    }
    if (agentOptions.some((option) => option.agentKey === currentAgentKey)) {
      return agentOptions;
    }
    return [
      { agentKey: currentAgentKey, agentId: null, isPrimary: false, label: currentAgentKey },
      ...agentOptions,
    ];
  }, [currentAgentKey, agentOptions, resolvedScope]);

  const applyScope = useCallback(
    async (agentKey: string): Promise<void> => {
      const nextScopeKeys = {
        agent_key: normalizeAgentKey(agentKey),
        workspace_key: scopeKeys.workspace_key,
      } satisfies WorkboardScopeKeys;
      core.workboardStore.setScopeKeys(nextScopeKeys);
      if (!isConnected) return;
      await core.workboardStore.refreshList();
    },
    [core.workboardStore, isConnected, scopeKeys.workspace_key],
  );

  return (
    <div className="flex flex-wrap items-center gap-3">
      {agentListError ? (
        <Alert
          variant="error"
          title="Agent list unavailable"
          description={agentListError}
          onDismiss={() => setAgentListError(null)}
        />
      ) : null}
      <Select
        data-testid="workboard-scope-agent"
        aria-label="Workboard agent scope"
        className="min-w-44"
        value={currentAgentKey}
        onChange={(event) => {
          void applyScope(event.currentTarget.value);
        }}
      >
        {visibleAgentOptions.map((option) => (
          <option key={option.agentKey} value={option.agentKey}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function WorkboardToolbarActions(props: WorkboardScopeControlsProps) {
  return <WorkboardScopeControls {...props} />;
}
