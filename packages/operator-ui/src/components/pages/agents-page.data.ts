import type { OperatorCore } from "@tyrum/operator-app";
import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { useOperatorStore } from "../../use-operator-store.js";
import { normalizeAgentOptions } from "./agent-options.shared.js";
import { selectInitialAgentKey, type ManagedAgentOption } from "./agents-page.lib.js";

export function useAgentsPageData(input: {
  core: OperatorCore;
  isConnected: boolean;
  selectedAgentKey: string;
  setAgentOptions: Dispatch<SetStateAction<ManagedAgentOption[]>>;
  setAgentsError: Dispatch<SetStateAction<string | null>>;
  setAgentsLoading: Dispatch<SetStateAction<boolean>>;
  setSelectedAgentKey: Dispatch<SetStateAction<string>>;
}) {
  const {
    core,
    isConnected,
    selectedAgentKey,
    setAgentOptions,
    setAgentsError,
    setAgentsLoading,
    setSelectedAgentKey,
  } = input;
  const agentStatus = useOperatorStore(core.agentStatusStore);
  const selectedAgentKeyRef = useRef(selectedAgentKey);
  selectedAgentKeyRef.current = selectedAgentKey;

  const syncSelectedAgentStatus = useCallback(
    async (agentKey: string): Promise<void> => {
      const normalizedAgentKey = agentKey.trim();
      core.agentStatusStore.setAgentKey(normalizedAgentKey);
      if (normalizedAgentKey.length === 0) {
        return;
      }
      await core.agentStatusStore.refresh();
    },
    [core.agentStatusStore],
  );

  const refreshManagedAgents = useCallback(
    async (preferredAgentKey?: string): Promise<string> => {
      if (!isConnected) {
        return "";
      }
      setAgentsLoading(true);
      setAgentsError(null);
      try {
        const response = await core.admin.agents.list();
        const nextAgents = normalizeAgentOptions(
          response.agents,
          ({ agentKey, personaName, source }) => ({
            agentKey,
            agentId: source.agent_id.trim(),
            displayName: personaName || agentKey,
            canDelete: source.can_delete,
            isPrimary: source.is_primary === true,
          }),
          {
            sort: (left, right) => left.displayName.localeCompare(right.displayName),
          },
        );
        const nextSelectedAgentKey = selectInitialAgentKey({
          currentAgentKey: preferredAgentKey ?? selectedAgentKeyRef.current,
          availableAgents: nextAgents,
        });
        setAgentOptions(nextAgents);
        core.agentStatusStore.setAgentKey(nextSelectedAgentKey);
        setSelectedAgentKey(nextSelectedAgentKey);
        return nextSelectedAgentKey;
      } catch (error) {
        setAgentsError(error instanceof Error ? error.message : String(error));
        setAgentOptions([]);
        return "";
      } finally {
        setAgentsLoading(false);
      }
    },
    [
      core.admin.agents,
      core.agentStatusStore,
      isConnected,
      setAgentOptions,
      setAgentsError,
      setAgentsLoading,
      setSelectedAgentKey,
    ],
  );

  const refreshEverything = useCallback(async (): Promise<void> => {
    if (!isConnected) {
      return;
    }
    core.transcriptStore.setAgentKey(null);
    core.transcriptStore.setChannel(null);
    core.transcriptStore.setActiveOnly(false);
    core.transcriptStore.setArchived(false);
    const [nextSelectedAgentKey] = await Promise.all([
      refreshManagedAgents(),
      core.transcriptStore.refresh(),
    ]);
    await syncSelectedAgentStatus(nextSelectedAgentKey);
  }, [core.transcriptStore, isConnected, refreshManagedAgents, syncSelectedAgentStatus]);

  useEffect(() => {
    if (!isConnected) {
      core.agentStatusStore.setAgentKey("");
      return;
    }
    void refreshEverything();
  }, [core.agentStatusStore, isConnected, refreshEverything]);

  useEffect(() => {
    if (!isConnected) {
      return;
    }
    const normalizedAgentKey = selectedAgentKey.trim();
    if (normalizedAgentKey.length === 0) {
      core.agentStatusStore.setAgentKey("");
      return;
    }
    if (agentStatus.agentKey === normalizedAgentKey) {
      return;
    }
    void syncSelectedAgentStatus(normalizedAgentKey);
  }, [
    agentStatus.agentKey,
    core.agentStatusStore,
    isConnected,
    selectedAgentKey,
    syncSelectedAgentStatus,
  ]);

  return {
    agentStatus,
    refreshEverything,
    refreshManagedAgents,
    syncSelectedAgentStatus,
  };
}
