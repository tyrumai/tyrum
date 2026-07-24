import {
  DEFAULT_EXECUTION_BACKEND,
  type AgentTurnRequest,
  type AgentTurnResponse,
  type ExecutionBackendId,
} from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";
import { ConversationExecutionBackendOverrideDal } from "./execution-backend-override-dal.js";

export type ExecutionBackendTurnOptions = {
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  execution?: {
    planId: string;
    turnId: string;
    stepApprovalId?: string;
  };
};

/**
 * The one thing the turn runner and the WS layer use from a streamed turn.
 *
 * Stated structurally rather than as `ReturnType<typeof streamText>` because a
 * backend that produces `chat.ui-message.stream` chunks itself — every harness
 * adapter — has no ai-sdk `streamText` result to hand back. The native
 * backend's full result satisfies this unchanged.
 */
export type ExecutionBackendUiMessageStream = {
  toUIMessageStream: (options?: never) => AsyncIterable<unknown>;
};

export type ExecutionBackendStreamHandle = {
  streamResult: ExecutionBackendUiMessageStream;
  finalize: () => Promise<AgentTurnResponse>;
};

export interface ExecutionBackend {
  readonly id: ExecutionBackendId;
  executeTurn(
    input: AgentTurnRequest,
    opts?: ExecutionBackendTurnOptions,
  ): Promise<AgentTurnResponse>;
  executeTurnStream(
    input: AgentTurnRequest,
    opts?: ExecutionBackendTurnOptions,
  ): Promise<ExecutionBackendStreamHandle>;
}

type NativeExecutionBackendOptions = {
  executeTurn: ExecutionBackend["executeTurn"];
  executeTurnStream?: ExecutionBackend["executeTurnStream"];
};

export class NativeExecutionBackend implements ExecutionBackend {
  readonly id = DEFAULT_EXECUTION_BACKEND;

  constructor(private readonly native: NativeExecutionBackendOptions) {}

  async executeTurn(
    input: AgentTurnRequest,
    opts?: ExecutionBackendTurnOptions,
  ): Promise<AgentTurnResponse> {
    return await this.native.executeTurn(input, opts);
  }

  async executeTurnStream(
    input: AgentTurnRequest,
    opts?: ExecutionBackendTurnOptions,
  ): Promise<ExecutionBackendStreamHandle> {
    if (!this.native.executeTurnStream) {
      throw new Error("native execution backend streaming is not configured");
    }
    return await this.native.executeTurnStream(input, opts);
  }
}

export class ExecutionBackendUnavailableError extends Error {
  readonly backendId: ExecutionBackendId;

  constructor(backendId: ExecutionBackendId) {
    super(`execution backend '${backendId}' is not available yet (ARCH-22 Phase 0)`);
    this.name = "ExecutionBackendUnavailableError";
    this.backendId = backendId;
  }
}

export class UnavailableExecutionBackend implements ExecutionBackend {
  constructor(readonly id: ExecutionBackendId) {}

  async executeTurn(): Promise<AgentTurnResponse> {
    throw new ExecutionBackendUnavailableError(this.id);
  }

  async executeTurnStream(): Promise<ExecutionBackendStreamHandle> {
    throw new ExecutionBackendUnavailableError(this.id);
  }
}

/**
 * Harness backends registered for this process, keyed by id.
 *
 * Absent entries stay unavailable, so a conversation flagged onto a backend the
 * deployment has not wired up fails loudly instead of silently running native.
 */
export type HarnessExecutionBackends = Partial<Record<ExecutionBackendId, ExecutionBackend>>;

export function createExecutionBackendResolver(input: {
  overrideDal: ConversationExecutionBackendOverrideDal;
  nativeBackend: NativeExecutionBackend;
  harnessBackends?: HarnessExecutionBackends;
}): {
  resolve(tenantId: string, conversationId: string): Promise<ExecutionBackend>;
} {
  return {
    resolve: async (tenantId, conversationId) => {
      const override = await input.overrideDal.get({ tenantId, conversationId });
      const backendId = override?.backend_id ?? DEFAULT_EXECUTION_BACKEND;
      if (backendId === DEFAULT_EXECUTION_BACKEND) {
        return input.nativeBackend;
      }
      return input.harnessBackends?.[backendId] ?? new UnavailableExecutionBackend(backendId);
    },
  };
}

export async function resolveExecutionBackendForConversation(input: {
  db: SqlDb;
  tenantId: string;
  conversationKey: string;
  nativeBackend: NativeExecutionBackend;
  harnessBackends?: HarnessExecutionBackends;
}): Promise<ExecutionBackend> {
  const conversation = await input.db.get<{ conversation_id: string }>(
    `SELECT conversation_id
       FROM conversations
       WHERE tenant_id = ? AND conversation_key = ?
       LIMIT 1`,
    [input.tenantId, input.conversationKey],
  );
  if (!conversation?.conversation_id) {
    return input.nativeBackend;
  }

  return await createExecutionBackendResolver({
    overrideDal: new ConversationExecutionBackendOverrideDal(input.db),
    nativeBackend: input.nativeBackend,
    harnessBackends: input.harnessBackends,
  }).resolve(input.tenantId, conversation.conversation_id);
}
