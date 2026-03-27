import { vi } from "vitest";
import { act } from "react";
import type { OperatorCore } from "../../../operator-app/src/index.js";
import { createStore } from "../../../operator-app/src/store.js";
import { sampleManagedAgentDetail } from "../operator-ui.agent-test-fixtures.js";
import {
  createTranscriptFixture,
  sampleAgentStatus,
  sampleAvailableModels,
  sampleConfiguredProviders,
  samplePresets,
  sampleRegistry,
} from "./agents-page.test-fixtures.ts";

export async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

export function createCore(options?: {
  list?: ReturnType<typeof vi.fn>;
  get?: ReturnType<typeof vi.fn>;
  create?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
  remove?: ReturnType<typeof vi.fn>;
  listPresets?: ReturnType<typeof vi.fn>;
  createPreset?: ReturnType<typeof vi.fn>;
  listAvailableModels?: ReturnType<typeof vi.fn>;
  listRegistry?: ReturnType<typeof vi.fn>;
  listProviders?: ReturnType<typeof vi.fn>;
  createProviderAccount?: ReturnType<typeof vi.fn>;
  transcriptState?: Partial<{
    agentKey: string | null;
    channel: string | null;
    activeOnly: boolean;
    archived: boolean;
    conversations: unknown[];
    nextCursor: string | null;
    selectedConversationKey: string | null;
    detail: {
      rootConversationKey: string;
      focusConversationKey: string;
      conversations: unknown[];
      events: unknown[];
    } | null;
    loadingList: boolean;
    loadingDetail: boolean;
    errorList: { message: string } | null;
    errorDetail: { message: string } | null;
  }>;
  subagentClose?: ReturnType<typeof vi.fn>;
}) {
  const transcriptFixture = createTranscriptFixture();
  const defaultAgentList = {
    agents: [
      {
        agent_key: "default",
        agent_id: "11111111-1111-4111-8111-111111111111",
        can_delete: false,
        is_primary: true,
        persona: { name: "Feynman" },
      },
      {
        agent_key: "agent-1",
        agent_id: "22222222-2222-4222-8222-222222222222",
        can_delete: true,
        is_primary: false,
        persona: { name: "Ada" },
      },
    ],
  };

  const { store: connectionStore } = createStore({
    status: "connected",
    clientId: null,
    lastDisconnect: null,
    transportError: null,
    recovering: false,
  });
  const { store: statusStore } = createStore({
    status: { conversation_lanes: null },
    usage: null,
    presenceByInstanceId: {},
    loading: { status: false, usage: false, presence: false },
    error: { status: null, usage: null, presence: null },
    lastSyncedAt: null,
  });
  const { store: agentStatusStore, setState: setAgentStatusState } = createStore({
    agentKey: "missing-agent",
    status: sampleAgentStatus(),
    loading: false,
    error: null,
    lastSyncedAt: null,
  });
  const { store: turnsStore } = createStore({
    turnsById: {},
    stepsById: {},
    attemptsById: {},
    stepIdsByTurnId: {},
    attemptIdsByStepId: {},
    agentKeyByTurnId: {},
    conversationKeyByTurnId: {},
  });
  const { store: transcriptStoreBase, setState: setTranscriptState } = createStore({
    agentKey: null as string | null,
    channel: null as string | null,
    activeOnly: false,
    archived: false,
    conversations: transcriptFixture.conversations,
    nextCursor: null as string | null,
    selectedConversationKey: transcriptFixture.latestRootSession.conversation_key as string | null,
    detail: {
      rootConversationKey: transcriptFixture.latestRootSession.conversation_key,
      focusConversationKey: transcriptFixture.latestRootSession.conversation_key,
      conversations:
        transcriptFixture.lineages[transcriptFixture.latestRootSession.conversation_key]
          ?.conversations,
      events:
        transcriptFixture.lineages[transcriptFixture.latestRootSession.conversation_key]?.events,
    },
    loadingList: false,
    loadingDetail: false,
    errorList: null as { message: string } | null,
    errorDetail: null as { message: string } | null,
    ...options?.transcriptState,
  });

  const setAgentKey = vi.fn((agentKey: string) => {
    setAgentStatusState((prev) => ({ ...prev, agentKey }));
  });
  const refresh = vi.fn().mockResolvedValue(undefined);
  const openConversation = vi.fn(async (sessionKey: string) => {
    const lineage =
      transcriptFixture.lineages[sessionKey as keyof typeof transcriptFixture.lineages] ??
      Object.values(transcriptFixture.lineages).find((candidate) =>
        candidate.conversations.some((session) => session.conversation_key === sessionKey),
      ) ??
      null;
    setTranscriptState((prev) => ({
      ...prev,
      selectedConversationKey: sessionKey,
      detail: lineage
        ? {
            rootConversationKey: lineage.rootConversationKey,
            focusConversationKey: sessionKey,
            conversations: lineage.conversations,
            events: lineage.events,
          }
        : null,
    }));
  });
  const clearDetail = vi.fn(() => {
    setTranscriptState((prev) => ({
      ...prev,
      selectedConversationKey: null,
      detail: null,
      errorDetail: null,
      loadingDetail: false,
    }));
  });
  const transcriptStore = {
    ...transcriptStoreBase,
    setAgentKey: vi.fn((agentKey: string | null) => {
      setTranscriptState((prev) => ({ ...prev, agentKey }));
    }),
    setChannel: vi.fn((channel: string | null) => {
      setTranscriptState((prev) => ({ ...prev, channel }));
    }),
    setActiveOnly: vi.fn((activeOnly: boolean) => {
      setTranscriptState((prev) => ({ ...prev, activeOnly }));
    }),
    setArchived: vi.fn((archived: boolean) => {
      setTranscriptState((prev) => ({ ...prev, archived }));
    }),
    refresh: vi.fn(async () => {}),
    loadMore: vi.fn(async () => {}),
    openConversation,
    clearDetail,
  };
  const subagentClose =
    options?.subagentClose ??
    vi.fn(async () => ({
      subagent: {
        subagent_id: transcriptFixture.childSession.subagent_id,
        tenant_id: "tenant-default",
        agent_id: "00000000-0000-4000-8000-000000000001",
        workspace_id: "00000000-0000-4000-8000-000000000002",
        parent_conversation_key: transcriptFixture.latestRootSession.conversation_key,
        conversation_key: transcriptFixture.childSession.conversation_key,
        execution_profile: "executor",
        status: "closed",
        created_at: "2026-03-09T00:01:00.000Z",
        updated_at: "2026-03-09T00:06:00.000Z",
        closed_at: "2026-03-09T00:06:00.000Z",
      },
    }));
  const artifactsApi = {
    getMetadata: vi.fn(async () => ({ sensitivity: "internal" })),
    getBytes: vi.fn(async () => ({
      kind: "redirect",
      url: `https://gateway.test/artifacts/${transcriptFixture.artifact.artifact_id}`,
    })),
  };

  const core = {
    connectionStore,
    statusStore,
    agentStatusStore: { ...agentStatusStore, setAgentKey, refresh },
    transcriptStore,
    chatSocket: {
      connected: true,
      requestDynamic: vi.fn(async (type: string) => {
        if (type === "subagent.close") {
          return await subagentClose();
        }
        throw new Error(`unsupported dynamic request: ${type}`);
      }),
      onDynamicEvent: vi.fn(),
      offDynamicEvent: vi.fn(),
    },
    admin: {
      agents: {
        list: options?.list ?? vi.fn().mockResolvedValue(defaultAgentList),
        get: options?.get ?? vi.fn().mockResolvedValue(sampleManagedAgentDetail("default")),
        capabilities: vi.fn(async () => ({
          skills: {
            default_mode: "allow",
            allow: [],
            deny: [],
            workspace_trusted: true,
            items: [],
          },
          mcp: { default_mode: "allow", allow: [], deny: [], items: [] },
          tools: { default_mode: "allow", allow: [], deny: [], items: [] },
        })),
        create: options?.create ?? vi.fn().mockResolvedValue(sampleManagedAgentDetail("default")),
        update: options?.update ?? vi.fn().mockResolvedValue(sampleManagedAgentDetail("default")),
        delete: options?.remove ?? vi.fn().mockResolvedValue({ deleted: true }),
      },
      providerConfig: {
        listRegistry: options?.listRegistry ?? vi.fn().mockResolvedValue(sampleRegistry()),
        listProviders:
          options?.listProviders ?? vi.fn().mockResolvedValue(sampleConfiguredProviders()),
        createAccount:
          options?.createProviderAccount ?? vi.fn().mockResolvedValue({ status: "ok" }),
      },
      modelConfig: {
        listPresets: options?.listPresets ?? vi.fn().mockResolvedValue(samplePresets()),
        createPreset:
          options?.createPreset ??
          vi.fn().mockResolvedValue({ preset: samplePresets().presets[0] }),
        listAvailable:
          options?.listAvailableModels ?? vi.fn().mockResolvedValue(sampleAvailableModels()),
      },
      extensions: {
        list: vi.fn().mockResolvedValue({ items: [] }),
        get: vi.fn(),
        parseMcpSettings: vi.fn(),
      },
      artifacts: artifactsApi,
    },
    turnsStore,
    httpBaseUrl: "https://gateway.test",
  } as unknown as OperatorCore;

  return {
    core,
    setAgentKey,
    refresh,
    transcriptStore,
    setTranscriptState,
    subagentClose,
    artifactsApi,
    transcriptFixture,
  };
}

export {
  sampleAgentStatus,
  createTranscriptFixture,
  sampleAvailableModels,
  sampleConfiguredProviders,
  samplePresets,
  sampleRegistry,
};
export { sampleManagedAgentDetail };
