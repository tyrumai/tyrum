import { isFileUIPart, isTextUIPart, type UIMessage } from "ai";
import type { TyrumAiSdkChatSession, TyrumAiSdkChatSessionSummary } from "@tyrum/operator-app";
import type { ChatThreadSummary } from "./chat-page-threads.js";

export const DEFAULT_CHAT_TITLE = "New chat";

function firstLine(text: string | null | undefined): string {
  return typeof text === "string" ? (text.split(/\r?\n/)[0]?.trim() ?? "") : "";
}

export function getSessionDisplayTitle(title: string | null | undefined): string {
  return firstLine(title) || DEFAULT_CHAT_TITLE;
}

function deriveSessionPreview(session: TyrumAiSdkChatSessionSummary): string {
  return (
    firstLine(session.last_message?.text ?? "") || (session.message_count > 0 ? "Attachment" : "")
  );
}

function deriveSessionTitle(session: TyrumAiSdkChatSessionSummary): string {
  return getSessionDisplayTitle(session.title);
}

export function toThreadSummary(session: TyrumAiSdkChatSessionSummary): ChatThreadSummary {
  return {
    agent_id: session.agent_id,
    session_id: session.session_id,
    channel: session.channel,
    thread_id: session.thread_id,
    title: deriveSessionTitle(session),
    created_at: session.created_at,
    updated_at: session.updated_at,
    message_count: session.message_count,
    preview: deriveSessionPreview(session),
    archived: session.archived ?? false,
  };
}

function describeFilePreview(part: Extract<UIMessage["parts"][number], { type: "file" }>): string {
  const filename = firstLine(part.filename);
  if (filename) {
    return filename;
  }
  return part.mediaType.startsWith("image/") ? "Image attachment" : "Attachment";
}

function describeMessagePreview(message: UIMessage): string {
  for (const part of message.parts) {
    if (isTextUIPart(part)) {
      const text = firstLine(part.text);
      if (text) {
        return text;
      }
      continue;
    }
    if (isFileUIPart(part)) {
      return describeFilePreview(part);
    }
  }
  return "";
}

export function buildPreview(messages: UIMessage[]): TyrumAiSdkChatSessionSummary["last_message"] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }
    const text = describeMessagePreview(message);
    if (text.length > 0) {
      return { role: message.role, text };
    }
  }
  return null;
}

export function applySessionMessages(
  session: TyrumAiSdkChatSession,
  messages: UIMessage[],
): TyrumAiSdkChatSession {
  return {
    ...session,
    messages,
    message_count: messages.length,
    last_message: buildPreview(messages),
    updated_at: new Date().toISOString(),
  };
}

export function patchSessionList(
  sessions: TyrumAiSdkChatSessionSummary[],
  session: TyrumAiSdkChatSession,
): TyrumAiSdkChatSessionSummary[] {
  const next = sessions.filter((entry) => entry.session_id !== session.session_id);
  return [session, ...next];
}
