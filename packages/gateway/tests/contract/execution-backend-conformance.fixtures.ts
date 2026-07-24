import {
  IdentityPack,
  PolicyBundle,
  type AgentTurnRequest,
  type ExecutionBackendId,
  type TyrumUIMessage,
  type TyrumUIMessagePart,
} from "@tyrum/contracts";
import { PolicyService } from "@tyrum/runtime-policy";
import type { AgentContextStore } from "../../src/modules/agent/context-store.js";
import { ConversationDal, type ConversationRow } from "../../src/modules/agent/conversation-dal.js";
import type { ExecutionBackend } from "../../src/modules/agent/execution-backend.js";
import { ApprovalDal, type ApprovalRow } from "../../src/modules/approval/dal.js";
import { resolveApproval } from "../../src/modules/approval/resolve-service.js";
import { ChannelThreadDal } from "../../src/modules/channels/thread-dal.js";
import { HarnessSessionDal } from "../../src/modules/harness/session-dal.js";
import type { HarnessTranslatorSink } from "../../src/modules/harness/translation.js";
import { DEFAULT_TENANT_ID, IdentityScopeDal } from "../../src/modules/identity/scope.js";
import { MemoryDal } from "../../src/modules/memory/memory-dal.js";
import { PolicyOverrideDal } from "../../src/modules/policy/override-dal.js";
import { PolicySnapshotDal } from "../../src/modules/policy/snapshot-dal.js";
import { createGatewayConfigStore } from "../../src/modules/runtime-state/gateway-config-store.js";
import type { SqlDb } from "../../src/statestore/types.js";
import { seedDeploymentPolicyBundle } from "../helpers/runtime-config.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

/**
 * Shared world and fixture contract for the execution-backend conformance suite.
 *
 * Everything Tyrum owns — the database, the conversation, policy, approvals, the
 * harness session cache — is built here once and handed to every backend under
 * test. A backend contributes only its own adapter and a scripted harness
 * session, so TYR-9 (OpenCode) and TYR-10 (Codex) reuse the criteria verbatim.
 */

export const CONFORMANCE_CHANNEL = "ui";
export const CONFORMANCE_THREAD_ID = "conformance-thread";
export const CONFORMANCE_PROMPT = "check the repository state";

export const CONFORMANCE_REQUEST: AgentTurnRequest = {
  channel: CONFORMANCE_CHANNEL,
  thread_id: CONFORMANCE_THREAD_ID,
  parts: [{ type: "text", text: CONFORMANCE_PROMPT }],
};

/**
 * Gates the shell tool and nothing else.
 *
 * Read-only tools fall to the implicit `read_only -> allow` decision, which is
 * what lets a backend project them into a harness-native fast path.
 */
export const CONFORMANCE_POLICY_BUNDLE = {
  v: 1,
  tools: { allow: [], require_approval: ["bash"], deny: [] },
};

/** Identity port double; the real store needs a full gateway container. */
const CONFORMANCE_CONTEXT_STORE: AgentContextStore = {
  ensureAgentContext: async () => {},
  getIdentity: async () => IdentityPack.parse({ meta: { name: "Ada", style: { tone: "direct" } } }),
  getEnabledSkills: async () => [],
  getEnabledMcpServers: async () => [],
};

const CONFORMANCE_NOW = new Date("2026-07-24T12:00:00.000Z");

/** A scripted harness action, expressed without reference to any one harness. */
export type ConformanceAction =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "read_file"; readonly path: string; readonly output: string }
  | { readonly kind: "shell"; readonly command: string; readonly output: string };

/** One harness session; the suite scripts one entry per session the harness starts. */
export interface ConformanceTurnScript {
  /** Continuity id the harness reports for this session. */
  readonly sessionRef: string;
  readonly actions: readonly ConformanceAction[];
  /**
   * The harness no longer holds the continuity state for the ref it is asked to
   * resume, and refuses to start. Criterion 5's fresh-context recovery.
   */
  readonly rejectsResume?: boolean;
}

/** What the harness was handed when a session started. */
export interface ConformanceSessionObservation {
  /** Continuity ref the backend asked the harness to resume, when any. */
  readonly resumeRef?: string;
  /** Tyrum-owned prompt text seeded into the harness session. */
  readonly systemPromptAppend: string;
  /** Tools the backend pre-authorized, so they never reach the ask channel. */
  readonly autoAllowedTools: readonly string[];
}

/** One ask-channel round trip, as the harness observed it. */
export interface ConformancePermission {
  readonly toolName: string;
  readonly allowed: boolean;
  /** The denial text the harness surfaces to the model. */
  readonly message?: string;
}

/**
 * A backend wired to a scripted harness.
 *
 * The three observation arrays are live: the suite reads them while a turn is
 * still in flight to prove a gated call had not run yet.
 */
export interface ScriptedExecutionBackend {
  readonly backend: ExecutionBackend;
  readonly sessions: readonly ConformanceSessionObservation[];
  readonly permissions: readonly ConformancePermission[];
  /** Harness-native tool names actually executed, in order. */
  readonly executed: readonly string[];
}

/** Tyrum-side services every harness backend is built over. */
export interface ConformanceServices {
  readonly db: SqlDb;
  readonly conversationDal: ConversationDal;
  readonly approvalDal: ApprovalDal;
  readonly policyService: PolicyService;
  readonly sessionDal: HarnessSessionDal;
  readonly memoryDal: MemoryDal;
  readonly contextStore: AgentContextStore;
  readonly tenantId: string;
  readonly agentKey: string;
  readonly workspaceKey: string;
  readonly workspaceRoot: string;
  readonly approvalWaitMs: number;
  readonly approvalPollMs: number;
  readonly logger: {
    info: (message: string, fields?: Record<string, unknown>) => void;
    warn: (message: string, fields?: Record<string, unknown>) => void;
  };
  readonly now: () => Date;
  readonly newId: () => string;
}

export interface ExecutionBackendConformanceFixture {
  readonly backendId: ExecutionBackendId;
  /** Harness-native names of the two tools the suite scripts. */
  readonly toolNames: { readonly readFile: string; readonly shell: string };
  /** Builds the backend under test over real services and a scripted session. */
  createScriptedBackend(input: {
    services: ConformanceServices;
    sink: HarnessTranslatorSink;
    script: readonly ConformanceTurnScript[];
  }): ScriptedExecutionBackend;
}

export interface ConformanceWorld {
  readonly services: ConformanceServices;
  /** The conversation the backend is required to resolve for the request. */
  readonly conversation: ConversationRow;
  close(): Promise<void>;
}

/** Opens an isolated SQLite gateway with every migration applied. */
export async function createConformanceWorld(options?: {
  bundle?: unknown;
  approvalWaitMs?: number;
}): Promise<ConformanceWorld> {
  const database = openTestSqliteDb();
  try {
    await seedDeploymentPolicyBundle(
      database,
      PolicyBundle.parse(options?.bundle ?? CONFORMANCE_POLICY_BUNDLE),
    );

    const conversationDal = new ConversationDal(
      database,
      new IdentityScopeDal(database),
      new ChannelThreadDal(database),
    );
    // Pre-created so the suite holds the ids; the backend must resolve this very
    // conversation rather than minting one of its own.
    const conversation = await conversationDal.getOrCreate({
      tenantId: DEFAULT_TENANT_ID,
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: CONFORMANCE_CHANNEL,
      providerThreadId: CONFORMANCE_THREAD_ID,
      containerKind: "channel",
    });

    let seq = 0;
    const services: ConformanceServices = {
      db: database,
      conversationDal,
      approvalDal: new ApprovalDal(database),
      policyService: new PolicyService({
        snapshotDal: new PolicySnapshotDal(database),
        overrideDal: new PolicyOverrideDal(database),
        configStore: createGatewayConfigStore({ db: database }),
      }),
      sessionDal: new HarnessSessionDal(database),
      memoryDal: new MemoryDal(database),
      contextStore: CONFORMANCE_CONTEXT_STORE,
      tenantId: DEFAULT_TENANT_ID,
      agentKey: "default",
      workspaceKey: "default",
      workspaceRoot: "/workspace",
      approvalWaitMs: options?.approvalWaitMs ?? 10_000,
      approvalPollMs: 5,
      logger: { info: () => {}, warn: () => {} },
      now: () => CONFORMANCE_NOW,
      newId: () => `conformance-id-${(seq += 1)}`,
    };

    return {
      services,
      conversation,
      close: async () => {
        await database.close();
      },
    };
  } catch (err) {
    await database.close();
    throw err;
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Settles a turn without letting a failing assertion turn its rejection into an
 * unhandled promise: the suite deliberately holds an unawaited turn while it
 * resolves the approval that turn is blocked on.
 */
export function settle<T>(
  promise: Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

export async function unwrap<T>(
  settled: Promise<{ ok: true; value: T } | { ok: false; error: unknown }>,
): Promise<T> {
  const outcome = await settled;
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

/** Blocks until the harness has parked a call on a durable approval. */
export async function waitForPendingApproval(
  services: ConformanceServices,
  timeoutMs = 3_000,
): Promise<ApprovalRow> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pending = await services.approvalDal.getPending({ tenantId: services.tenantId });
    const approval = pending[0];
    if (approval) return approval;
    await delay(2);
  }
  throw new Error("the gated tool call never created a durable approval");
}

/**
 * Resolves an approval exactly as `POST /approvals/:id/respond` does, so the
 * suite exercises the operator path rather than a shortcut through the DAL.
 */
export async function resolveApprovalAsOperator(input: {
  services: ConformanceServices;
  approvalId: string;
  decision: "approved" | "denied";
  reason?: string;
}): Promise<ApprovalRow> {
  const result = await resolveApproval(
    {
      approvalDal: input.services.approvalDal,
      policyOverrideDal: new PolicyOverrideDal(input.services.db),
    },
    {
      tenantId: input.services.tenantId,
      approvalId: input.approvalId,
      decision: input.decision,
      reason: input.reason,
      resolvedBy: { kind: "http" },
    },
  );
  if (!result.ok) {
    throw new Error(`operator resolution failed (${result.code}): ${result.message}`);
  }
  if (!result.transitioned) {
    throw new Error(`approval '${input.approvalId}' did not transition to ${input.decision}`);
  }
  return result.approval;
}

export async function readTranscript(world: ConformanceWorld): Promise<TyrumUIMessage[]> {
  const stored = await world.services.conversationDal.getById({
    tenantId: world.services.tenantId,
    conversationId: world.conversation.conversation_id,
  });
  if (!stored) {
    throw new Error(`conversation '${world.conversation.conversation_id}' is no longer readable`);
  }
  return stored.messages;
}

/**
 * The durable transcript part for a harness tool call.
 *
 * `tool-<name>` is the shape the operator UI's `isToolUIPart` requires, so a
 * backend that recorded the call under any other part type would leave the call
 * invisible in chat.
 */
export function findToolPart(
  messages: readonly TyrumUIMessage[],
  toolName: string,
): TyrumUIMessagePart {
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === `tool-${toolName}`) return part;
    }
  }
  throw new Error(`no transcript part of type 'tool-${toolName}' was recorded`);
}

export function hasToolPart(messages: readonly TyrumUIMessage[], toolName: string): boolean {
  return messages.some((message) => message.parts.some((part) => part.type === `tool-${toolName}`));
}
