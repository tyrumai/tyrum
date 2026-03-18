import type { NormalizedMessageEnvelope } from "@tyrum/schemas";

export class GoogleChatNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleChatNormalizationError";
  }
}

export type GoogleChatActor = {
  name?: string;
  displayName?: string;
  email?: string;
  type?: string;
};

export type GoogleChatMessage = {
  name?: string;
  text?: string;
  argumentText?: string;
  thread?: { name?: string };
  sender?: GoogleChatActor;
};

export type GoogleChatEvent = {
  type?: string;
  eventTime?: string;
  message?: GoogleChatMessage;
  space?: {
    name?: string;
    type?: string;
    displayName?: string;
  };
  user?: GoogleChatActor;
};

export function parseGoogleChatEvent(payload: string): GoogleChatEvent {
  try {
    return JSON.parse(payload) as GoogleChatEvent;
  } catch (err) {
    throw new GoogleChatNormalizationError(
      `failed to deserialize google chat event: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function extractGoogleChatSender(event: GoogleChatEvent): GoogleChatActor | undefined {
  return event.message?.sender ?? event.user;
}

export function extractGoogleChatText(event: GoogleChatEvent): string {
  const raw = event.message?.argumentText ?? event.message?.text ?? "";
  return raw.trim();
}

export function buildGoogleChatEnvelope(input: { accountKey: string; event: GoogleChatEvent }): {
  envelope: NormalizedMessageEnvelope;
  containerId: string;
  isDm: boolean;
  senderId: string;
  senderEmail?: string;
  senderType?: string;
} {
  const spaceName = input.event.space?.name?.trim();
  const sender = extractGoogleChatSender(input.event);
  const senderId = sender?.name?.trim();
  const messageName = input.event.message?.name?.trim();
  const contentText = extractGoogleChatText(input.event);
  if (!spaceName) {
    throw new GoogleChatNormalizationError("google chat event is missing space.name");
  }
  if (!senderId) {
    throw new GoogleChatNormalizationError("google chat event is missing sender.name");
  }
  if (!messageName) {
    throw new GoogleChatNormalizationError("google chat event is missing message.name");
  }
  if (!contentText) {
    throw new GoogleChatNormalizationError("google chat event is missing message text");
  }

  const isDm = (input.event.space?.type ?? "").trim().toUpperCase() === "DM";
  const threadName = input.event.message?.thread?.name?.trim();
  const containerId = isDm ? senderId : threadName || spaceName;
  const receivedAt = input.event.eventTime?.trim() || new Date().toISOString();

  return {
    envelope: {
      message_id: messageName,
      received_at: receivedAt,
      delivery: {
        channel: "googlechat",
        account: input.accountKey,
      },
      container: {
        kind: isDm ? "dm" : "group",
        id: containerId,
      },
      sender: {
        id: senderId,
        ...(sender?.displayName?.trim() ? { display: sender.displayName.trim() } : {}),
      },
      content: {
        text: contentText,
        attachments: [],
      },
      provenance: ["user"],
    },
    containerId,
    isDm,
    senderId,
    ...(sender?.email?.trim() ? { senderEmail: sender.email.trim().toLowerCase() } : {}),
    ...(sender?.type?.trim() ? { senderType: sender.type.trim().toUpperCase() } : {}),
  };
}
