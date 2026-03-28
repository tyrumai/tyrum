import type { OperatorCore } from "@tyrum/operator-app";
import { buildAgentConversationKey, type NodeInventoryEntry } from "@tyrum/contracts";
import { useEffect, useMemo, useState } from "react";
import { formatErrorMessage } from "../../utils/format-error-message.js";

type ActiveChatConversation = {
  agent_key: string;
  channel: string;
  thread_id: string;
  updated_at: string;
};

type PairingPageNodeInventoryState = {
  nodes: NodeInventoryEntry[];
  byNodeId: Record<string, NodeInventoryEntry>;
  loading: boolean;
  error: string | null;
  key: string | null;
};

function buildConversationKey(conversation: ActiveChatConversation | null): string | null {
  if (!conversation) return null;
  try {
    return buildAgentConversationKey({
      agentKey: conversation.agent_key,
      container: "channel",
      channel: conversation.channel,
      account: "default",
      id: conversation.thread_id,
    });
  } catch {
    return null;
  }
}

export function useNodeInventory(input: {
  core: OperatorCore;
  connected: boolean;
  activeConversation?: ActiveChatConversation | null;
  refreshAt: string | null;
}): PairingPageNodeInventoryState {
  const { core, connected, activeConversation, refreshAt } = input;
  const key = useMemo(() => buildConversationKey(activeConversation ?? null), [activeConversation]);
  const [state, setState] = useState<PairingPageNodeInventoryState>({
    nodes: [],
    byNodeId: {},
    loading: false,
    error: null,
    key,
  });

  useEffect(() => {
    let cancelled = false;

    if (!connected) {
      setState({ nodes: [], byNodeId: {}, loading: false, error: null, key });
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null, key }));

    void core.admin.nodes
      .list({
        dispatchable_only: false,
        ...(key ? { key } : {}),
      })
      .then((response) => {
        if (cancelled) return;
        const byNodeId: Record<string, NodeInventoryEntry> = {};
        for (const node of response.nodes) {
          byNodeId[node.node_id] = node;
        }
        setState({
          nodes: response.nodes,
          byNodeId,
          loading: false,
          error: null,
          key,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setState({
          nodes: [],
          byNodeId: {},
          loading: false,
          error: formatErrorMessage(error),
          key,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [core.admin.nodes, connected, key, refreshAt, activeConversation?.updated_at]);

  return state;
}
