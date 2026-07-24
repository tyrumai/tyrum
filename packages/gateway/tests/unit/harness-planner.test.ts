import { afterEach, describe, expect, it } from "vitest";
import {
  ConversationState,
  IdentityPack,
  PolicyBundle,
  type AgentTurnRequest,
  type TyrumUIMessage,
} from "@tyrum/contracts";
import { PolicyService } from "@tyrum/runtime-policy";
import { ApprovalDal } from "../../src/modules/approval/dal.js";
import { ConversationDal } from "../../src/modules/agent/conversation-dal.js";
import { ChannelThreadDal } from "../../src/modules/channels/thread-dal.js";
import { DEFAULT_TENANT_ID, IdentityScopeDal } from "../../src/modules/identity/scope.js";
import { MemoryDal } from "../../src/modules/memory/memory-dal.js";
import { PolicyOverrideDal } from "../../src/modules/policy/override-dal.js";
import { PolicySnapshotDal } from "../../src/modules/policy/snapshot-dal.js";
import { createGatewayConfigStore } from "../../src/modules/runtime-state/gateway-config-store.js";
import { createClaudeAgentSdkExecutionBackendFromServices } from "../../src/modules/harness/claude-agent-sdk/assembly.js";
import { createClaudeAgentSdkTurnPlanner } from "../../src/modules/harness/claude-agent-sdk/planner.js";
import type {
  ClaudeQuery,
  ClaudeQueryInput,
} from "../../src/modules/harness/claude-agent-sdk/client.js";
import { HarnessSessionDal } from "../../src/modules/harness/session-dal.js";
import type { UiMessageChunk } from "../../src/modules/harness/translation.js";
import type { AgentContextStore } from "../../src/modules/agent/context-store.js";
import { coerceRecord } from "../../src/modules/util/coerce.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { seedDeploymentPolicyBundle } from "../helpers/runtime-config.js";

const THREAD_ID = "thread-1";
const CONNECTOR = "ui";
const NOW = new Date("2026-07-24T12:00:00.000Z");
/** `AgentTurnResponse.turn_id` is a UUID, as the turn runner mints it. */
const TURN_ID = "11111111-1111-4111-8111-111111111111";

const REQUEST: AgentTurnRequest = {
  channel: CONNECTOR,
  thread_id: THREAD_ID,
  parts: [{ type: "text", text: "read the readme" }],
};

/** Test double for the identity port; the real store needs a full container. */
const CONTEXT_STORE: AgentContextStore = {
  ensureAgentContext: async () => {},
  getIdentity: async () => IdentityPack.parse({ meta: { name: "Ada", style: { tone: "direct" } } }),
  getEnabledSkills: async () => [],
  getEnabledMcpServers: async () => [],
};

let db: SqliteDb | undefined;

afterEach(async () => {
  await db?.close();
  db = undefined;
});

async function setup(bundle?: unknown) {
  const database = openTestSqliteDb();
  db = database;

  await seedDeploymentPolicyBundle(
    database,
    PolicyBundle.parse(
      bundle ?? { v: 1, tools: { allow: [], require_approval: ["bash"], deny: [] } },
    ),
  );

  const conversationDal = new ConversationDal(
    database,
    new IdentityScopeDal(database),
    new ChannelThreadDal(database),
  );
  const conversation = await conversationDal.getOrCreate({
    tenantId: DEFAULT_TENANT_ID,
    scopeKeys: { agentKey: "default", workspaceKey: "default" },
    connectorKey: CONNECTOR,
    providerThreadId: THREAD_ID,
    containerKind: "channel",
  });

  let seq = 0;
  const deps = {
    db: database,
    conversationDal,
    sessionDal: new HarnessSessionDal(database),
    policyService: new PolicyService({
      snapshotDal: new PolicySnapshotDal(database),
      overrideDal: new PolicyOverrideDal(database),
      configStore: createGatewayConfigStore({ db: database }),
    }),
    contextStore: CONTEXT_STORE,
    memoryDal: new MemoryDal(database),
    tenantId: DEFAULT_TENANT_ID,
    agentKey: "default",
    workspaceKey: "default",
    logger: { info: () => {}, warn: () => {} },
    resolveWorkspaceRoot: () => "/workspace",
    now: () => NOW,
    newId: () => `id-${(seq += 1)}`,
  };

  return { conversation, conversationDal, deps, database };
}

/** History that must survive the harness turn's write. */
const PRIOR_HISTORY: TyrumUIMessage[] = [
  { id: "prior-user", role: "user", parts: [{ type: "text", text: "hello" }] },
  { id: "prior-assistant", role: "assistant", parts: [{ type: "text", text: "hi" }] },
];

/** A scripted SDK session: one Read tool call, then a text reply. */
function scriptedQuery(capture: { input?: ClaudeQueryInput }): ClaudeQuery {
  return (queryInput) => {
    capture.input = queryInput;
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: "system", subtype: "init", session_id: "sdk-session-1" };
        const fire = async (event: string, response?: unknown): Promise<void> => {
          for (const group of queryInput.options.hooks[event] ?? []) {
            for (const hook of group.hooks) {
              await hook(
                {
                  hook_event_name: event,
                  tool_name: "Read",
                  tool_input: { file_path: "README.md" },
                  tool_response: response,
                },
                "call-1",
                {},
              );
            }
          }
        };
        await fire("PreToolUse");
        await fire("PostToolUse", "file contents");
        yield { type: "assistant", message: { content: [{ type: "text", text: "Done." }] } };
        yield { type: "result", result: "Done." };
      },
    };
  };
}

/** A scripted SDK session with no tool calls, so turns can repeat verbatim. */
function textOnlyQuery(reply: string): ClaudeQuery {
  return () => ({
    async *[Symbol.asyncIterator]() {
      yield { type: "system", subtype: "init", session_id: "sdk-session-1" };
      yield { type: "assistant", message: { content: [{ type: "text", text: reply }] } };
      yield { type: "result", result: reply };
    },
  });
}

describe("claude agent sdk turn planner", () => {
  it("resolves the conversation, prompt and checkpoint", async () => {
    const { conversation, conversationDal, deps } = await setup();
    await conversationDal.replaceContextState({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: conversation.conversation_id,
      contextState: ConversationState.parse({
        version: 1,
        checkpoint: { goal: "ship the harness", handoff_md: "resume from planner" },
        updated_at: NOW.toISOString(),
      }),
    });

    const plan = await createClaudeAgentSdkTurnPlanner(deps).plan(REQUEST);

    expect(plan.context).toMatchObject({
      backendId: "claude_agent_sdk",
      tenantId: conversation.tenant_id,
      agentId: conversation.agent_id,
      workspaceId: conversation.workspace_id,
      conversationId: conversation.conversation_id,
      conversationKey: conversation.conversation_key,
      channel: CONNECTOR,
      threadId: THREAD_ID,
      workspaceRoot: "/workspace",
    });
    expect(plan.prompt).toBe("read the readme");
    expect(plan.resumeSessionRef).toBeUndefined();
    // Identity/persona, the checkpoint, and pre-turn recall.
    expect(plan.systemPromptAppend).toContain("Identity: Ada");
    expect(plan.systemPromptAppend).toContain("Conversation state:");
    expect(plan.systemPromptAppend).toContain("Goal: ship the harness");
    expect(plan.systemPromptAppend).toContain("Pre-turn recall (mcp.memory.seed):");
  });

  it("carries the turn id so messages and approvals can be attributed to it", async () => {
    const { deps } = await setup();
    const plan = await createClaudeAgentSdkTurnPlanner(deps).plan(REQUEST, { turnId: "turn-42" });
    expect(plan.context.turnId).toBe("turn-42");
  });

  it("carries the execution-profile and state-mode role ceiling", async () => {
    const { deps } = await setup();
    const plan = await createClaudeAgentSdkTurnPlanner({
      ...deps,
      deploymentConfig: { state: { mode: "shared" } },
    }).plan(REQUEST);

    // Without this the router cannot apply the ceiling that makes `bash` an
    // unconditional deny rather than an approvable prompt in shared mode.
    expect(plan.context.roleCeiling?.stateMode).toBe("shared");
    expect(plan.context.roleCeiling?.toolAllowlist).toContain("bash");
  });

  it("persists the user and assistant messages without destroying prior history", async () => {
    const { conversation, conversationDal, deps, database } = await setup();
    await conversationDal.replaceMessages({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: conversation.conversation_id,
      messages: PRIOR_HISTORY,
    });

    const capture: { input?: ClaudeQueryInput } = {};
    const chunks: UiMessageChunk[] = [];
    const backend = createClaudeAgentSdkExecutionBackendFromServices({
      ...deps,
      approvalDal: new ApprovalDal(database),
      approvalWaitMs: 1_000,
      approvalPollMs: 10,
      sink: { emitChunk: (chunk) => void chunks.push(chunk) },
      query: scriptedQuery(capture),
    });

    const response = await backend.executeTurn(REQUEST);

    expect(response).toMatchObject({
      reply: "Done.",
      conversation_id: conversation.conversation_id,
      conversation_key: conversation.conversation_key,
      used_tools: ["Read"],
      memory_written: false,
    });

    const stored = await conversationDal.getById({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: conversation.conversation_id,
    });
    const messages = stored?.messages ?? [];
    expect(messages).toHaveLength(4);
    expect(messages.slice(0, 2)).toEqual(PRIOR_HISTORY);
    expect(messages[2]).toMatchObject({
      role: "user",
      parts: [{ type: "text", text: "read the readme" }],
    });
    // Tool evidence, not just text: an auto-allowed Read must be durable.
    expect(messages[3]?.role).toBe("assistant");
    expect(messages[3]?.parts).toEqual([
      {
        type: "tool-Read",
        toolCallId: "call-1",
        state: "output-available",
        input: { file_path: "README.md" },
        output: "file contents",
      },
      { type: "text", text: "Done.", state: "done" },
    ]);
    expect(capture.input?.options.cwd).toBe("/workspace");
  });

  it("records a turn that repeats the previous exchange verbatim", async () => {
    const { conversation, conversationDal, deps, database } = await setup();
    const backend = () =>
      createClaudeAgentSdkExecutionBackendFromServices({
        ...deps,
        approvalDal: new ApprovalDal(database),
        approvalWaitMs: 1_000,
        approvalPollMs: 10,
        sink: { emitChunk: () => {} },
        query: textOnlyQuery("Done."),
      });

    await backend().executeTurn(REQUEST);
    const afterFirst = await conversationDal.getById({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: conversation.conversation_id,
    });
    expect(afterFirst?.messages).toHaveLength(2);

    // The same prompt, the same reply, no tool parts: byte-identical to the
    // pair already stored. A single two-message append would be treated as an
    // overlap and the whole turn would vanish from the transcript.
    await backend().executeTurn(REQUEST);

    const afterSecond = await conversationDal.getById({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: conversation.conversation_id,
    });
    expect(afterSecond?.messages).toHaveLength(4);
    expect(afterSecond?.messages.at(-1)).toMatchObject({
      role: "assistant",
      parts: [{ type: "text", text: "Done.", state: "done" }],
    });
  });

  it("does not duplicate a user message the chat surface already persisted", async () => {
    const { conversation, conversationDal, deps, database } = await setup();
    await conversationDal.replaceMessages({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: conversation.conversation_id,
      messages: [
        { id: "ui-user", role: "user", parts: [{ type: "text", text: "read the readme" }] },
      ],
    });

    await createClaudeAgentSdkExecutionBackendFromServices({
      ...deps,
      approvalDal: new ApprovalDal(database),
      approvalWaitMs: 1_000,
      approvalPollMs: 10,
      sink: { emitChunk: () => {} },
      query: textOnlyQuery("Done."),
    }).executeTurn(REQUEST);

    const stored = await conversationDal.getById({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: conversation.conversation_id,
    });
    expect(stored?.messages).toHaveLength(2);
    expect(stored?.messages[0]?.role).toBe("user");
    expect(stored?.messages[1]?.role).toBe("assistant");
  });

  it("serves the operator-UI turn path through the streaming port", async () => {
    const { conversation, conversationDal, deps, database } = await setup();
    const backend = createClaudeAgentSdkExecutionBackendFromServices({
      ...deps,
      approvalDal: new ApprovalDal(database),
      approvalWaitMs: 1_000,
      approvalPollMs: 10,
      sink: { emitChunk: () => {} },
      query: scriptedQuery({}),
    });

    // Exactly what `turnViaTurnRunnerStream` does on the first attempt: it calls
    // `executeTurnStream` with no backend-id check and no fallback, so a backend
    // that cannot serve it makes the conversation unusable from the UI.
    const handle = await backend.executeTurnStream(REQUEST, {
      abortSignal: new AbortController().signal,
      timeoutMs: 1_000,
      execution: { planId: "plan-1", turnId: TURN_ID },
    });

    const chunkTypes: string[] = [];
    for await (const chunk of handle.streamResult.toUIMessageStream()) {
      const record = coerceRecord(chunk);
      if (typeof record?.["type"] === "string") chunkTypes.push(record["type"]);
    }
    const response = await handle.finalize();

    expect(chunkTypes).toContain("tool-input-available");
    expect(chunkTypes).toContain("text-delta");
    expect(chunkTypes.at(-1)).toBe("finish");
    expect(response.reply).toBe("Done.");
    expect(response.turn_id).toBe(TURN_ID);

    // Attribution: without the turn id the transcript cannot be linked back to
    // the turn that produced it.
    const stored = await conversationDal.getById({
      tenantId: DEFAULT_TENANT_ID,
      conversationId: conversation.conversation_id,
    });
    for (const message of stored?.messages ?? []) {
      expect(message.metadata?.["turn_id"]).toBe(TURN_ID);
    }
  });

  it("resumes the harness session recorded by the previous turn", async () => {
    const { deps, database } = await setup();
    const backend = createClaudeAgentSdkExecutionBackendFromServices({
      ...deps,
      approvalDal: new ApprovalDal(database),
      approvalWaitMs: 1_000,
      approvalPollMs: 10,
      sink: { emitChunk: () => {} },
      query: scriptedQuery({}),
    });

    await backend.executeTurn(REQUEST);
    const next = await createClaudeAgentSdkTurnPlanner(deps).plan(REQUEST);

    expect(next.resumeSessionRef).toBe("sdk-session-1");
  });
});
