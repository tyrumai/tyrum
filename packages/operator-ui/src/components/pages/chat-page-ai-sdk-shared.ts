import { isFileUIPart, isTextUIPart, type UIMessage } from "ai";
import type {
  TyrumAiSdkChatConversation,
  TyrumAiSdkChatConversationSummary,
} from "@tyrum/operator-app";
import type { ChatThreadSummary } from "./chat-page-threads.js";

export const DEFAULT_CHAT_TITLE = "New chat";

function firstLine(text: string | null | undefined): string {
  return typeof text === "string" ? (text.split(/\r?\n/)[0]?.trim() ?? "") : "";
}

export function getConversationDisplayTitle(title: string | null | undefined): string {
  return firstLine(title) || DEFAULT_CHAT_TITLE;
}

function deriveConversationPreview(conversation: TyrumAiSdkChatConversationSummary): string {
  return (
    firstLine(conversation.last_message?.text ?? "") ||
    (conversation.message_count > 0 ? "Attachment" : "")
  );
}

function deriveConversationTitle(conversation: TyrumAiSdkChatConversationSummary): string {
  return getConversationDisplayTitle(conversation.title);
}

export function toThreadSummary(
  conversation: TyrumAiSdkChatConversationSummary,
): ChatThreadSummary {
  return {
    agent_key: conversation.agent_key,
    conversation_id: conversation.conversation_id,
    channel: conversation.channel,
    thread_id: conversation.thread_id,
    title: deriveConversationTitle(conversation),
    created_at: conversation.created_at,
    updated_at: conversation.updated_at,
    message_count: conversation.message_count,
    preview: deriveConversationPreview(conversation),
    archived: conversation.archived ?? false,
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

export function buildPreview(
  messages: UIMessage[],
): TyrumAiSdkChatConversationSummary["last_message"] {
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

export function applyConversationMessages(
  conversation: TyrumAiSdkChatConversation,
  messages: UIMessage[],
): TyrumAiSdkChatConversation {
  return {
    ...conversation,
    messages,
    message_count: messages.length,
    last_message: buildPreview(messages),
    updated_at: new Date().toISOString(),
  };
}

export function patchConversationList(
  conversations: TyrumAiSdkChatConversationSummary[],
  conversation: TyrumAiSdkChatConversation,
): TyrumAiSdkChatConversationSummary[] {
  const next = conversations.filter(
    (entry) => entry.conversation_id !== conversation.conversation_id,
  );
  return [conversation, ...next];
}
