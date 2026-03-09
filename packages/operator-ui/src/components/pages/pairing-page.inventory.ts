import type { OperatorCore } from "@tyrum/operator-core";
import { buildAgentSessionKey, type NodeInventoryEntry } from "@tyrum/schemas";
import { useEffect, useMemo, useState } from "react";
import { formatErrorMessage } from "../../utils/format-error-message.js";

type ActiveChatSession = {
  agent_id: string;
  channel: string;
  thread_id: string;
  updated_at: string;
};

type PairingPageNodeInventoryState = {
  byNodeId: Record<string, NodeInventoryEntry>;
  loading: boolean;
  error: string | null;
  key: string | null;
};

function buildSessionKey(session: ActiveChatSession | null): string | null {
  if (!session) return null;
  try {
    return buildAgentSessionKey({
      agentKey: session.agent_id,
      container: "channel",
      channel: session.channel,
      account: "default",
      id: session.thread_id,
    });
  } catch {
    return null;
  }
}

export function usePairingPageNodeInventory(input: {
  core: OperatorCore;
  connected: boolean;
  activeSession: ActiveChatSession | null;
  refreshAt: string | null;
}): PairingPageNodeInventoryState {
  const { core, connected, activeSession, refreshAt } = input;
  const key = useMemo(() => buildSessionKey(activeSession), [activeSession]);
  const [state, setState] = useState<PairingPageNodeInventoryState>({
    byNodeId: {},
    loading: false,
    error: null,
    key,
  });

  useEffect(() => {
    let cancelled = false;

    if (!connected) {
      setState({ byNodeId: {}, loading: false, error: null, key });
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null, key }));

    void core.http.nodes
      .list({
        dispatchable_only: false,
        ...(key ? { key, lane: "main" } : {}),
      })
      .then((response) => {
        if (cancelled) return;
        const byNodeId: Record<string, NodeInventoryEntry> = {};
        for (const node of response.nodes) {
          byNodeId[node.node_id] = node;
        }
        setState({ byNodeId, loading: false, error: null, key });
      })
      .catch((error) => {
        if (cancelled) return;
        setState({
          byNodeId: {},
          loading: false,
          error: formatErrorMessage(error),
          key,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [core.http.nodes, connected, key, refreshAt, activeSession?.updated_at]);

  return state;
}
