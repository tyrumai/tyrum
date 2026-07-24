import { randomUUID } from "node:crypto";
import {
  AgentTurnResponse,
  SubagentConversationKey,
  type AgentTurnRequest,
  type AgentTurnResponse as AgentTurnResponseT,
  type NormalizedContainerKind,
  type TyrumUIMessage,
  type TyrumUIMessagePart,
} from "@tyrum/contracts";
import type { PolicyService } from "@tyrum/runtime-policy";
import type { SqlDb } from "../../../statestore/types.js";
import type { AgentContextStore } from "../../agent/context-store.js";
import type { ConversationDal } from "../../agent/conversation-dal.js";
import {
  getExecutionProfile,
  type ExecutionProfile,
  type ExecutionProfileId,
} from "../../agent/execution-profiles.js";
import { resolveAgentHome, resolveTyrumHome } from "../../agent/home.js";
import { resolveAgentTurnInput } from "../../agent/runtime/turn-helpers.js";
import { normalizeInternalTurnRequestIfNeeded } from "../../agent/runtime/turn-request-normalization.js";
import { buildUserTurnMessage } from "../../ai-sdk/attachment-parts.js";
import { appendWithoutDuplicateOverlap } from "../../ai-sdk/message-overlap.js";
import { parseChannelSourceKey } from "../../channels/interface.js";
import type { MemoryDal } from "../../memory/memory-dal.js";
import { resolveGatewayStateMode } from "../../runtime-state/mode.js";
import type { HarnessSessionDal } from "../session-dal.js";
import type { HarnessTurnContext } from "../types.js";
import { CLAUDE_AGENT_SDK_BACKEND_ID, type ClaudeAgentSdkTurnPlan } from "./backend.js";
import {
  buildHarnessPromptAppend,
  loadEffectiveAgentConfig,
  type HarnessPlannerLogger,
} from "./planner-inputs.js";

export interface ClaudeAgentSdkPlannerDeps {
  readonly db: SqlDb;
  readonly conversationDal: ConversationDal;
  readonly sessionDal: HarnessSessionDal;
  readonly policyService: PolicyService;
  readonly contextStore: AgentContextStore;
  readonly memoryDal: MemoryDal;
  /** Tenant UUID this runtime serves. */
  readonly tenantId: string;
  /** Default agent *key* (not UUID), used when the request omits one. */
  readonly agentKey: string;
  /** Default workspace *key* (not UUID), used when the request omits one. */
  readonly workspaceKey: string;
  readonly logger: HarnessPlannerLogger;
  /** Raw deployment config; only the gateway state mode is read from it. */
  readonly deploymentConfig?: unknown;
  /**
   * Filesystem root the harness is confined to, and the root policy match
   * targets are made relative to. Defaults to the agent home, which is what the
   * native path passes to `canonicalizeToolMatchTarget`; anything else silently
   * changes which `read:`/`write:` rules fire.
   */
  readonly resolveWorkspaceRoot?: (input: { agentKey: string }) => string;
  readonly sandboxEnabled?: boolean;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export interface ClaudeAgentSdkPersistTurnInput {
  readonly context: HarnessTurnContext;
  readonly prompt: string;
  readonly parts: TyrumUIMessagePart[];
  readonly reply: string;
  readonly usedTools: readonly string[];
}

/** The slice of `ExecutionBackendTurnOptions.execution` a plan needs. */
export interface HarnessTurnExecution {
  readonly turnId?: string;
}

export interface ClaudeAgentSdkPlanner {
  plan(input: AgentTurnRequest, execution?: HarnessTurnExecution): Promise<ClaudeAgentSdkTurnPlan>;
  persistTurn(input: ClaudeAgentSdkPersistTurnInput): Promise<AgentTurnResponseT>;
}

/**
 * The execution profile a harness turn runs under.
 *
 * `resolveExecutionProfile` needs the turn's queue target and the workboard to
 * read a subagent's recorded profile; a harness turn has neither, so the
 * conversation key is used the same way that function uses it, and a subagent
 * conversation falls back to `explorer_ro` — the same fallback the native path
 * takes when the subagent record cannot be read. Fail-closed: the fallback is
 * the most restrictive subagent profile, never a wider one.
 */
function resolveHarnessExecutionProfile(conversationKey: string): {
  id: ExecutionProfileId;
  profile: ExecutionProfile;
} {
  const id: ExecutionProfileId = SubagentConversationKey.safeParse(conversationKey).success
    ? "explorer_ro"
    : "interaction";
  return { id, profile: getExecutionProfile(id) };
}

/** What `plan` resolved and `persistTurn` needs again, without re-deriving it. */
interface PlannedTurn {
  readonly userParts: readonly TyrumUIMessagePart[];
}

function textPart(text: string): TyrumUIMessagePart {
  return { type: "text", text };
}

function withTurnMetadata(
  message: TyrumUIMessage,
  input: { createdAt: string; turnId?: string },
): TyrumUIMessage {
  return {
    ...message,
    metadata: {
      ...message.metadata,
      created_at: input.createdAt,
      ...(input.turnId ? { turn_id: input.turnId } : {}),
    },
  };
}

/**
 * Builds the turn planner and the durable-transcript writer for the Claude
 * Agent SDK backend.
 *
 * `plan` resolves everything a harness turn needs out of Tyrum's own state —
 * the conversation, the prompt, the persona/checkpoint/recall append, the
 * resume ref, and the policy-derived read-only fast path — so the adapter never
 * reaches for a service itself. `persistTurn` writes the result back into the
 * durable transcript, which is what keeps a harness turn fully readable from
 * Tyrum regardless of harness-side session state.
 */
export function createClaudeAgentSdkTurnPlanner(
  deps: ClaudeAgentSdkPlannerDeps,
): ClaudeAgentSdkPlanner {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => randomUUID());
  const stateMode = resolveGatewayStateMode(deps.deploymentConfig);
  const resolveWorkspaceRoot =
    deps.resolveWorkspaceRoot ??
    ((input: { agentKey: string }) => resolveAgentHome(resolveTyrumHome(), input.agentKey));

  /**
   * Carries the resolved user parts from `plan` to `persistTurn`.
   *
   * The adapter hands `persistTurn` the very `HarnessTurnContext` object `plan`
   * produced, so the context itself is the key: no turn registry to leak, no
   * cross-turn collision, and the entry disappears with the plan. `persistTurn`
   * still works without it, falling back to the prompt text.
   */
  const plannedTurns = new WeakMap<HarnessTurnContext, PlannedTurn>();

  return {
    plan: async (input, execution) => {
      const normalized = normalizeInternalTurnRequestIfNeeded(input);
      const resolved = resolveAgentTurnInput(normalized);
      const agentKey = normalized.agent_key?.trim() || deps.agentKey;
      const workspaceKey = normalized.workspace_key?.trim() || deps.workspaceKey;
      const containerKind: NormalizedContainerKind =
        normalized.container_kind ?? resolved.envelope?.container.kind ?? "channel";
      const channel = parseChannelSourceKey(resolved.channel);

      // Resolves the same conversation the native path would, and is the only
      // honest source of the tenant/agent/workspace *UUIDs* policy is evaluated
      // under — the runtime carries keys, not ids.
      const conversation = await deps.conversationDal.getOrCreate({
        tenantId: deps.tenantId,
        scopeKeys: { agentKey, workspaceKey },
        connectorKey: channel.connector,
        accountKey: resolved.envelope?.delivery.account ?? channel.accountId,
        providerThreadId: resolved.thread_id,
        containerKind,
      });

      const profile = resolveHarnessExecutionProfile(conversation.conversation_key);
      const context: HarnessTurnContext = {
        backendId: CLAUDE_AGENT_SDK_BACKEND_ID,
        tenantId: conversation.tenant_id,
        agentId: conversation.agent_id,
        workspaceId: conversation.workspace_id,
        conversationId: conversation.conversation_id,
        conversationKey: conversation.conversation_key,
        channel: resolved.channel,
        threadId: resolved.thread_id,
        // Carried so the turn's messages and approvals can be attributed to it,
        // exactly as `withTurnMetadata` does on the native path.
        turnId: execution?.turnId,
        workspaceRoot: resolveWorkspaceRoot({ agentKey }),
        roleCeiling: {
          stateMode,
          toolAllowlist: profile.profile.tool_allowlist,
          toolDenylist: profile.profile.tool_denylist,
        },
      };
      plannedTurns.set(context, { userParts: resolved.parts });

      const config = await loadEffectiveAgentConfig({
        db: deps.db,
        tenantId: context.tenantId,
        agentId: context.agentId,
        stateMode,
      });
      const [systemPromptAppend, session] = await Promise.all([
        buildHarnessPromptAppend({
          contextStore: deps.contextStore,
          memoryDal: deps.memoryDal,
          context,
          conversation,
          agentKey,
          config,
          query: resolved.message,
          nowIso: now().toISOString(),
          stateMode,
          logger: deps.logger,
        }),
        deps.sessionDal.get({
          tenantId: context.tenantId,
          conversationId: context.conversationId,
          backendId: CLAUDE_AGENT_SDK_BACKEND_ID,
        }),
      ]);

      deps.logger.info("harness.plan.built", {
        backend_id: context.backendId,
        conversation_id: context.conversationId,
        turn_id: context.turnId,
        resumed: session !== undefined,
        execution_profile: profile.id,
      });

      return {
        context,
        prompt: resolved.message,
        systemPromptAppend,
        resumeSessionRef: session?.session_ref,
        sandboxEnabled: deps.sandboxEnabled,
      };
    },

    persistTurn: async ({ context, prompt, parts, reply, usedTools }) => {
      // `replaceMessages` rewrites the whole transcript, so prior history must
      // be read and passed back with the new messages; passing only this turn
      // would delete the conversation and its artifact links.
      const conversation = await deps.conversationDal.getById({
        tenantId: context.tenantId,
        conversationId: context.conversationId,
      });
      if (!conversation) {
        throw new Error(
          `harness turn cannot be persisted: conversation '${context.conversationId}' not found`,
        );
      }

      const createdAt = now().toISOString();
      const userMessage = withTurnMetadata(
        buildUserTurnMessage({
          id: newId(),
          parts: plannedTurns.get(context)?.userParts,
          fallbackText: prompt,
        }),
        { createdAt, turnId: context.turnId },
      );

      // Tool parts are the evidence half of the transcript: without them an
      // auto-approved tool call would leave no durable record of what ran.
      const assistantParts =
        parts.length > 0 ? parts : reply.trim().length > 0 ? [textPart(reply)] : [];

      // Two appends, not one, and for the same reason `turn-finalization.ts`
      // splits them: `appendWithoutDuplicateOverlap` compares role and parts
      // only, so a single two-message append whose pair happens to repeat the
      // previous exchange verbatim would be discarded whole and the turn would
      // leave no durable record at all. Deduplicating the user message alone
      // still absorbs the copy the chat surface already persisted.
      const withUserMessage = appendWithoutDuplicateOverlap(conversation.messages, [userMessage]);
      const messages: TyrumUIMessage[] =
        assistantParts.length > 0
          ? [
              ...withUserMessage,
              withTurnMetadata(
                { id: newId(), role: "assistant", parts: assistantParts },
                { createdAt, turnId: context.turnId },
              ),
            ]
          : withUserMessage;

      await deps.conversationDal.replaceMessages({
        tenantId: context.tenantId,
        conversationId: context.conversationId,
        messages,
        updatedAt: createdAt,
      });

      return AgentTurnResponse.parse({
        reply,
        turn_id: context.turnId,
        conversation_id: context.conversationId,
        conversation_key: context.conversationKey,
        attachments: [],
        used_tools: [...usedTools],
        memory_written: false,
      });
    },
  };
}
