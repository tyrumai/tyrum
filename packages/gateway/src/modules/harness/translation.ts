import type { TyrumUIMessagePart } from "@tyrum/contracts";
import type { HarnessApprovalDecision, HarnessEvent } from "./types.js";

/**
 * Shared streaming translation layer.
 *
 * Turns a backend's normalized `HarnessEvent` stream into the two durable
 * outputs Tyrum owns: `chat.ui-message.stream` frames for live operator
 * surfaces, and transcript message parts for the durable conversation record.
 *
 * Lossy mappings are documented in this module's README.
 */

/** An AI-SDK `UIMessageChunk`. Shape is validated by the WS protocol layer. */
export type UiMessageChunk = Record<string, unknown> & { type: string };

export interface HarnessTranslatorSink {
  emitChunk(chunk: UiMessageChunk): void | Promise<void>;
}

export interface HarnessTranslator {
  handle(event: HarnessEvent): Promise<void>;
  /** Emitted when a gated call is waiting on a human, before the decision. */
  notePendingApproval(input: { callId: string; approvalId: string }): Promise<void>;
  /** Assistant message parts accumulated for the durable transcript. */
  assistantParts(): TyrumUIMessagePart[];
  replyText(): string;
  usedTools(): string[];
}

function toolPartType(toolName: string): string {
  return `tool-${toolName}`;
}

export function createHarnessTranslator(input: {
  sink: HarnessTranslatorSink;
  /** Stable id generator; injected so tests are deterministic. */
  newId: () => string;
}): HarnessTranslator {
  const parts: TyrumUIMessagePart[] = [];
  const toolPartsByCallId = new Map<string, TyrumUIMessagePart>();
  const usedTools = new Set<string>();
  const replyChunks: string[] = [];
  let openTextId: string | undefined;

  const emit = async (chunk: UiMessageChunk): Promise<void> => {
    await input.sink.emitChunk(chunk);
  };

  const closeOpenText = async (): Promise<void> => {
    if (openTextId === undefined) return;
    await emit({ type: "text-end", id: openTextId });
    openTextId = undefined;
  };

  /** No transcript part may be left mid-stream once the turn stops producing. */
  const settleStreamingText = (): void => {
    for (const part of parts) {
      if (part["type"] === "text" && part["state"] === "streaming") {
        part["state"] = "done";
      }
    }
  };

  const appendText = async (text: string): Promise<void> => {
    if (text.length === 0) return;
    if (openTextId === undefined) {
      openTextId = input.newId();
      await emit({ type: "text-start", id: openTextId });
      parts.push({ type: "text", text: "", state: "streaming" });
    }
    await emit({ type: "text-delta", id: openTextId, delta: text });
    replyChunks.push(text);
    const current = parts.at(-1);
    if (current && current["type"] === "text") {
      current["text"] = String(current["text"] ?? "") + text;
    }
  };

  const applyDecision = async (
    callId: string,
    decision: HarnessApprovalDecision,
  ): Promise<void> => {
    const part = toolPartsByCallId.get(callId);
    if (decision.kind === "deny") {
      await emit({ type: "tool-output-denied", toolCallId: callId });
      if (part) {
        part["state"] = "output-denied";
        part["errorText"] = decision.reason;
        if (decision.approvalId) {
          part["approval"] = { id: decision.approvalId, approved: false };
        }
      }
      return;
    }
    if (part && decision.approvalId) {
      part["approval"] = { id: decision.approvalId, approved: true };
    }
  };

  /**
   * Applies events one at a time, in arrival order.
   *
   * Every handler below mutates shared transcript state across `await` points,
   * and the harness runs tool batches in parallel — so without this a tool call
   * landing mid-update would leave `parts.at(-1)` pointing at the wrong part and
   * the text would be dropped from the durable transcript while the stream had
   * already shown it.
   */
  let pending: Promise<unknown> = Promise.resolve();
  const serialized = <T>(work: () => Promise<T>): Promise<T> => {
    const next = pending.then(work, work);
    pending = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const applyEvent = async (event: HarnessEvent): Promise<void> => {
    switch (event.kind) {
      case "session_started":
        return;
      case "assistant_text":
        await appendText(event.text);
        return;
      case "tool_call": {
        await closeOpenText();
        usedTools.add(event.call.toolName);
        const part: TyrumUIMessagePart = {
          type: toolPartType(event.call.toolName),
          toolCallId: event.call.callId,
          state: "input-available",
          input: event.call.input,
        };
        toolPartsByCallId.set(event.call.callId, part);
        parts.push(part);
        await emit({
          type: "tool-input-available",
          toolCallId: event.call.callId,
          toolName: event.call.toolName,
          input: event.call.input,
        });
        return;
      }
      case "approval_resolved":
        await applyDecision(event.callId, event.decision);
        return;
      case "tool_result": {
        const part = toolPartsByCallId.get(event.callId);
        if (event.ok) {
          await emit({
            type: "tool-output-available",
            toolCallId: event.callId,
            output: event.content,
          });
          if (part) {
            part["state"] = "output-available";
            part["output"] = event.content;
          }
          return;
        }
        await emit({
          type: "tool-output-error",
          toolCallId: event.callId,
          errorText: event.content,
        });
        if (part) {
          part["state"] = "output-error";
          part["errorText"] = event.content;
        }
        return;
      }
      case "turn_completed": {
        await closeOpenText();
        settleStreamingText();
        await emit({ type: "finish" });
        return;
      }
      case "error": {
        await closeOpenText();
        // The stream frame is ephemeral, so the failure must also land in the
        // durable transcript: without this, reloading history loses the cause
        // and leaves any partial text stuck in `streaming`.
        settleStreamingText();
        parts.push({ type: "harness-error", errorText: event.message });
        await emit({ type: "error", errorText: event.message });
        return;
      }
    }
  };

  const applyPendingApproval = async ({
    callId,
    approvalId,
  }: {
    callId: string;
    approvalId: string;
  }): Promise<void> => {
    const part = toolPartsByCallId.get(callId);
    if (part) {
      part["state"] = "approval-requested";
      part["approval"] = { id: approvalId };
    }
    await emit({ type: "tool-approval-request", toolCallId: callId, approvalId });
  };

  return {
    handle: async (event) => await serialized(async () => await applyEvent(event)),
    notePendingApproval: async (pendingApproval) =>
      await serialized(async () => await applyPendingApproval(pendingApproval)),
    assistantParts: () => parts,
    replyText: () => replyChunks.join(""),
    usedTools: () => [...usedTools],
  };
}
