import { randomUUID } from "node:crypto";
import {
  TranscriptTimelineEvent,
  WsAiSdkChatStreamEvent,
  WsConversationGetResult,
  WsConversationStreamStart,
  WsToolLifecycleEvent,
  WsContextReportCreatedEvent,
  WsApprovalUpdatedEvent,
  WsTranscriptGetResult,
  type Approval,
  type BenchmarkArtifact,
  type BenchmarkQuestionExcerpt,
  type BenchmarkTraceEvent,
  type ContextReport,
  type TyrumUIMessage,
  type WsAiSdkChatStreamEventPayload,
  type WsConversationCreateResult as WsConversationCreateResultT,
  type WsConversationGetResult as WsConversationGetResultT,
  type WsToolLifecycleEventPayload,
} from "@tyrum/contracts";
import type { TyrumClient } from "@tyrum/operator-app/node";
import { createQuestionExcerpt } from "./trace-normalizer.js";

export type ConversationTrace = {
  approvalEvents: Approval[];
  captureDiagnostics: {
    liveApprovalEvents: number;
    liveContextReports: number;
    liveToolEvents: number;
    transcriptApprovalEvents: number;
    transcriptContextReports: number;
    transcriptToolEvents: number;
  };
  contextReports: ContextReport[];
  conversation: WsConversationGetResultT["conversation"];
  conversationKey: string;
  finalReply: string | null;
  streamEvents: WsAiSdkChatStreamEventPayload[];
  toolEvents: WsToolLifecycleEventPayload[];
  transcript: WsTranscriptGetResult;
};

const TRACE_DRAIN_MS = 750;

function extractTextFromMessage(message: TyrumUIMessage): string {
  return message.parts
    .map((part) => {
      if (part.type !== "text") return "";
      const text = (part as Record<string, unknown>)["text"];
      return typeof text === "string" ? text : "";
    })
    .join("")
    .trim();
}

export function extractAssistantMessageExcerpts(
  conversation: WsTranscriptGetResult,
): BenchmarkQuestionExcerpt[] {
  return conversation.events.flatMap((event) => {
    if (event.kind !== "message") return [];
    if (event.payload.message.role !== "assistant") return [];
    const text = extractTextFromMessage(event.payload.message);
    if (!text) return [];
    return [createQuestionExcerpt(`transcript:${event.event_id}`, text)];
  });
}

export function collectArtifacts(trace: ConversationTrace): Record<string, BenchmarkArtifact> {
  const artifacts: Record<string, BenchmarkArtifact> = {
    transcript: { kind: "json", content: trace.transcript },
    conversation: { kind: "json", content: trace.conversation },
    stream_events: { kind: "json", content: trace.streamEvents },
    tool_events: { kind: "json", content: trace.toolEvents },
    context_reports: { kind: "json", content: trace.contextReports },
    approval_events: { kind: "json", content: trace.approvalEvents },
    capture_diagnostics: { kind: "json", content: trace.captureDiagnostics },
  };

  if (trace.finalReply) {
    artifacts["final_reply"] = { kind: "text", content: trace.finalReply };
  }

  return artifacts;
}

export function collectTraceEvents(trace: ConversationTrace): BenchmarkTraceEvent[] {
  const transcriptEvents = trace.transcript.events.map((event) => ({
    ref: `transcript:${event.event_id}`,
    kind: `transcript.${event.kind}`,
    payload: event,
  }));
  const streamEvents = trace.streamEvents.map((event, index) => ({
    ref: `stream:${String(index + 1)}`,
    kind: "stream",
    payload: event,
  }));
  const toolEvents = trace.toolEvents.map((event, index) => ({
    ref: `tool:${String(index + 1)}`,
    kind: "tool.lifecycle",
    payload: event,
  }));
  const contextReports = trace.contextReports.map((report, index) => ({
    ref: `context:${String(index + 1)}`,
    kind: "context_report.created",
    payload: report,
  }));
  const approvals = trace.approvalEvents.map((approval, index) => ({
    ref: `approval:${String(index + 1)}`,
    kind: "approval.updated",
    payload: approval,
  }));

  return [...transcriptEvents, ...streamEvents, ...toolEvents, ...contextReports, ...approvals];
}

export function getTraceCaptureIntegrityErrors(trace: ConversationTrace): string[] {
  const errors: string[] = [];
  if (
    trace.captureDiagnostics.transcriptToolEvents > 0 &&
    trace.captureDiagnostics.liveToolEvents === 0
  ) {
    errors.push(
      `live tool capture missed ${String(trace.captureDiagnostics.transcriptToolEvents)} transcript-backed tool events`,
    );
  }
  if (
    trace.captureDiagnostics.transcriptContextReports > 0 &&
    trace.captureDiagnostics.liveContextReports === 0
  ) {
    errors.push(
      `live context capture missed ${String(trace.captureDiagnostics.transcriptContextReports)} transcript-backed context reports`,
    );
  }
  if (
    trace.captureDiagnostics.transcriptApprovalEvents > 0 &&
    trace.captureDiagnostics.liveApprovalEvents === 0
  ) {
    errors.push(
      `live approval capture missed ${String(trace.captureDiagnostics.transcriptApprovalEvents)} transcript-backed approvals`,
    );
  }
  return errors;
}

function dedupeByKey<T>(values: readonly T[], getKey: (value: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const value of values) {
    byKey.set(getKey(value), value);
  }
  return [...byKey.values()];
}

function extractTranscriptToolLifecycleEvents(
  transcript: WsTranscriptGetResult,
): WsToolLifecycleEventPayload[] {
  return transcript.events.flatMap((event: TranscriptTimelineEvent) =>
    event.kind === "tool_lifecycle" ? [event.payload.tool_event] : [],
  );
}

function extractTranscriptContextReports(transcript: WsTranscriptGetResult): ContextReport[] {
  return transcript.events.flatMap((event: TranscriptTimelineEvent) =>
    event.kind === "context_report" ? [event.payload.report] : [],
  );
}

function extractTranscriptApprovalEvents(transcript: WsTranscriptGetResult): Approval[] {
  return transcript.events.flatMap((event: TranscriptTimelineEvent) =>
    event.kind === "approval" ? [event.payload.approval] : [],
  );
}

export async function sendPromptAndCollectTrace(
  ws: TyrumClient,
  conversation: WsConversationCreateResultT["conversation"],
  conversationKey: string,
  prompt: string,
  timeoutMs: number,
  autoApprove: boolean,
  drainMs = TRACE_DRAIN_MS,
): Promise<ConversationTrace> {
  const toolEvents: WsToolLifecycleEventPayload[] = [];
  const contextReports: ContextReport[] = [];
  const approvalEvents: Approval[] = [];
  const streamEvents: WsAiSdkChatStreamEventPayload[] = [];
  const pendingStreamEvents: WsAiSdkChatStreamEventPayload[] = [];
  let streamId: string | null = null;

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`benchmark turn timed out after ${String(timeoutMs)}ms`));
    }, timeoutMs);
    let finishScheduled = false;
    let terminalError: Error | null = null;

    const cleanup = (): void => {
      clearTimeout(timeout);
      ws.offDynamicEvent("chat.ui-message.stream", onStreamEvent);
      ws.offDynamicEvent("tool.lifecycle", onToolEvent);
      ws.offDynamicEvent("context_report.created", onContextEvent);
      ws.offDynamicEvent("approval.updated", onApprovalEvent);
    };

    const finish = (): void => {
      if (finishScheduled) return;
      finishScheduled = true;
      setTimeout(() => {
        cleanup();
        if (terminalError) {
          reject(terminalError);
          return;
        }
        resolve();
      }, drainMs);
    };

    const maybeRecordStreamEvent = (payload: WsAiSdkChatStreamEventPayload): void => {
      if (streamId && payload.stream_id !== streamId) return;
      streamEvents.push(payload);
      if (payload.stage === "done") {
        finish();
        return;
      }
      if (payload.stage === "error") {
        terminalError = new Error(payload.error.message);
        finish();
      }
    };

    const onStreamEvent = (event: unknown): void => {
      const parsed = WsAiSdkChatStreamEvent.safeParse(event);
      if (!parsed.success) return;
      if (!streamId) {
        pendingStreamEvents.push(parsed.data.payload);
        return;
      }
      maybeRecordStreamEvent(parsed.data.payload);
    };

    const onToolEvent = (event: unknown): void => {
      const parsed = WsToolLifecycleEvent.safeParse(event);
      if (!parsed.success) return;
      if (parsed.data.payload.conversation_id !== conversation.conversation_id) return;
      toolEvents.push(parsed.data.payload);
    };

    const onContextEvent = (event: unknown): void => {
      const parsed = WsContextReportCreatedEvent.safeParse(event);
      if (!parsed.success) return;
      if (parsed.data.payload.report.conversation_id !== conversation.conversation_id) return;
      contextReports.push(parsed.data.payload.report);
    };

    const onApprovalEvent = (event: unknown): void => {
      const parsed = WsApprovalUpdatedEvent.safeParse(event);
      if (!parsed.success) return;
      const approval = parsed.data.payload.approval;
      if (approval.scope?.conversation_key !== conversationKey) return;
      approvalEvents.push(approval);
      if (!autoApprove) return;
      if (!["queued", "reviewing", "awaiting_human"].includes(approval.status)) return;
      void ws.approvalResolve({
        approval_id: approval.approval_id,
        decision: "approved",
        reason: "benchmark auto-approval",
      });
    };

    ws.onDynamicEvent("chat.ui-message.stream", onStreamEvent);
    ws.onDynamicEvent("tool.lifecycle", onToolEvent);
    ws.onDynamicEvent("context_report.created", onContextEvent);
    ws.onDynamicEvent("approval.updated", onApprovalEvent);

    void (async () => {
      try {
        const messageId = `benchmark-${randomUUID()}`;
        const start = await ws.requestDynamic(
          "conversation.send",
          {
            conversation_id: conversation.conversation_id,
            messages: [
              {
                id: messageId,
                role: "user",
                parts: [{ type: "text", text: prompt }],
              },
            ],
            trigger: "submit-message",
          },
          WsConversationStreamStart,
        );
        streamId = start.stream_id;
        for (const event of pendingStreamEvents) {
          maybeRecordStreamEvent(event);
        }
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    })();
  });

  const fullConversation = await ws.requestDynamic(
    "conversation.get",
    { conversation_id: conversation.conversation_id },
    WsConversationGetResult,
  );
  const transcript = await ws.requestDynamic(
    "transcript.get",
    { conversation_key: conversationKey },
    WsTranscriptGetResult,
  );
  const finalAssistant = fullConversation.conversation.messages
    .toReversed()
    .find((message) => message.role === "assistant");
  const finalReply = finalAssistant ? extractTextFromMessage(finalAssistant) || null : null;
  const transcriptToolEvents = extractTranscriptToolLifecycleEvents(transcript);
  const transcriptContextReports = extractTranscriptContextReports(transcript);
  const transcriptApprovalEvents = extractTranscriptApprovalEvents(transcript);
  const mergedToolEvents = dedupeByKey(
    [...toolEvents, ...transcriptToolEvents],
    (event) => `${event.tool_call_id}:${event.status}`,
  );
  const mergedContextReports = dedupeByKey(
    [...contextReports, ...transcriptContextReports],
    (report) => report.context_report_id,
  );
  const mergedApprovalEvents = dedupeByKey(
    [...approvalEvents, ...transcriptApprovalEvents],
    (approval) => `${approval.approval_id}:${approval.status}`,
  );

  return {
    approvalEvents: mergedApprovalEvents,
    captureDiagnostics: {
      liveApprovalEvents: approvalEvents.length,
      liveContextReports: contextReports.length,
      liveToolEvents: toolEvents.length,
      transcriptApprovalEvents: transcriptApprovalEvents.length,
      transcriptContextReports: transcriptContextReports.length,
      transcriptToolEvents: transcriptToolEvents.length,
    },
    contextReports: mergedContextReports,
    conversation: fullConversation.conversation,
    conversationKey,
    finalReply,
    streamEvents,
    toolEvents: mergedToolEvents,
    transcript,
  };
}
