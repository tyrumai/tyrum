import type { UIMessageChunk } from "ai";
import type { WsResponseEnvelope, WsResponseOkEnvelope } from "@tyrum/contracts";
import type { GatewayContainer } from "../../src/container.js";

export function createChunkStream(chunks: UIMessageChunk[]): ReadableStream<UIMessageChunk> {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

export function createErroredChunkStream(
  chunks: UIMessageChunk[],
  error: Error,
): ReadableStream<UIMessageChunk> {
  let index = 0;
  return new ReadableStream<UIMessageChunk>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index]!);
        index += 1;
        return;
      }
      controller.error(error);
    },
  });
}

export function createTurnIngressStreamHandle(input?: {
  chunks?: UIMessageChunk[];
  finalize?: () => Promise<unknown>;
  outcome?: "completed" | "paused";
  stream?: ReadableStream<UIMessageChunk>;
}) {
  return {
    finalize: input?.finalize ?? (async () => undefined),
    outcome: Promise.resolve(input?.outcome ?? "completed"),
    streamResult: {
      toUIMessageStream: () => input?.stream ?? createChunkStream(input?.chunks ?? []),
    },
  };
}

export function readOkResult<T>(response: WsResponseEnvelope | undefined): T {
  if (!response || !("ok" in response) || response.ok !== true) {
    throw new Error("expected ok response envelope");
  }
  return (response as WsResponseOkEnvelope & { result: T }).result;
}

export async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result !== undefined) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out waiting for condition");
}

export async function seedPausedApprovalTurn(input: {
  assistantText: string;
  container: GatewayContainer;
  conversation: {
    agent_id: string;
    workspace_id: string;
    conversation_id: string;
    conversation_key: string;
  };
  tenantId: string;
  toolCallId: string;
  toolCommand: string;
  toolId: string;
  userText: string;
}): Promise<void> {
  await input.container.db.run(
    `INSERT INTO turn_jobs (
       tenant_id,
       job_id,
       agent_id,
       workspace_id,
       conversation_id,
       conversation_key,
       status,
       trigger_json,
       input_json,
       latest_turn_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.tenantId,
      "job-approval-1",
      input.conversation.agent_id,
      input.conversation.workspace_id,
      input.conversation.conversation_id,
      input.conversation.conversation_key,
      "queued",
      "{}",
      "{}",
      "turn-approval-1",
    ],
  );
  await input.container.db.run(
    `INSERT INTO turns (
       tenant_id,
       turn_id,
       job_id,
       conversation_key,
       status,
       attempt,
       created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.tenantId,
      "turn-approval-1",
      "job-approval-1",
      input.conversation.conversation_key,
      "paused",
      1,
      new Date().toISOString(),
    ],
  );
  const approval = await input.container.approvalDal.create({
    tenantId: input.tenantId,
    agentId: input.conversation.agent_id,
    workspaceId: input.conversation.workspace_id,
    approvalKey: "exec:turn-approval-1:step-approval-1:workflow_step",
    prompt: `Approve execution of '${input.toolId}'`,
    motivation: `approval required for tool '${input.toolId}'`,
    kind: "workflow_step",
    context: {
      source: "agent-tool-execution",
      tool_id: input.toolId,
      tool_call_id: input.toolCallId,
      args: { command: input.toolCommand },
      ai_sdk: {
        approval_id: "approval-seeded",
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: input.userText }],
          },
          {
            role: "assistant",
            content: [
              { type: "text", text: input.assistantText },
              {
                type: "tool-call",
                toolCallId: input.toolCallId,
                toolName: input.toolId,
                input: JSON.stringify({ command: input.toolCommand }),
              },
            ],
          },
        ],
      },
    },
    conversationId: input.conversation.conversation_id,
    runId: "turn-approval-1",
    status: "queued",
  });
  await input.container.db.run(
    `INSERT INTO execution_steps (
       tenant_id,
       step_id,
       turn_id,
       step_index,
       status,
       action_json,
       approval_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.tenantId,
      "step-approval-1",
      "turn-approval-1",
      0,
      "paused",
      JSON.stringify({ type: "Decide", args: {} }),
      approval.approval_id,
    ],
  );
}
