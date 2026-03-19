import { randomUUID } from "node:crypto";
import type { UIMessage } from "ai";
import {
  ArtifactRef,
  type ArtifactRef as ArtifactRefT,
  type NormalizedMessageEnvelope as NormalizedMessageEnvelopeT,
  type TyrumUIMessage,
  type TyrumUIMessagePart,
} from "@tyrum/contracts";
import type { ArtifactRecordInsertInput } from "../artifact/dal.js";
import type { ArtifactStore } from "../artifact/store.js";

export type FileMessagePart = TyrumUIMessagePart & {
  type: "file";
  url: string;
  mediaType: string;
  filename?: string;
};

type TextMessagePart = TyrumUIMessagePart & {
  type: "text";
  text: string;
};

export type MaterializedArtifactRecordScope = {
  tenantId: string;
  workspaceId: string;
  agentId: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isTextMessagePart(part: TyrumUIMessagePart): part is TextMessagePart {
  return part.type === "text" && typeof part["text"] === "string";
}

export function isFileMessagePart(part: TyrumUIMessagePart): part is FileMessagePart {
  return (
    part.type === "file" && typeof part["url"] === "string" && typeof part["mediaType"] === "string"
  );
}

function parseDataUrl(url: string): { body: Buffer; mimeType?: string } | null {
  const matched = url.match(/^data:([^;,]+)?;base64,([\s\S]+)$/i);
  if (!matched) {
    return null;
  }

  const mimeType = matched[1]?.trim() || undefined;
  const payload = matched[2]?.trim();
  if (!payload) {
    throw new Error("invalid file part data URL: missing payload");
  }

  return {
    body: Buffer.from(payload, "base64"),
    mimeType,
  };
}

async function materializeFilePart(
  part: FileMessagePart,
  artifactStore: ArtifactStore,
  maxUploadBytes?: number,
  artifactRecordScope?: MaterializedArtifactRecordScope,
  pendingArtifactRecords?: ArtifactRecordInsertInput[],
): Promise<FileMessagePart> {
  const parsed = parseDataUrl(part.url);
  if (!parsed) {
    return part;
  }
  if (typeof maxUploadBytes === "number" && parsed.body.byteLength > maxUploadBytes) {
    throw new Error(
      `attachment exceeds maxUploadBytes (${String(parsed.body.byteLength)} > ${String(maxUploadBytes)})`,
    );
  }

  const artifact = await artifactStore.put({
    kind: "file",
    body: parsed.body,
    mime_type: parsed.mimeType ?? part.mediaType,
    filename: typeof part.filename === "string" ? part.filename.trim() || undefined : undefined,
    metadata: {
      source: "chat-upload",
    },
  });
  if (!artifact.external_url) {
    throw new Error(`artifact '${artifact.artifact_id}' is missing external_url`);
  }
  if (artifactRecordScope && pendingArtifactRecords) {
    pendingArtifactRecords.push({
      artifact,
      tenantId: artifactRecordScope.tenantId,
      workspaceId: artifactRecordScope.workspaceId,
      agentId: artifactRecordScope.agentId,
      sensitivity: "normal",
      policySnapshotId: null,
    });
  }

  return {
    ...part,
    mediaType: artifact.mime_type ?? part.mediaType,
    url: artifact.external_url,
    ...(artifact.filename ? { filename: artifact.filename } : {}),
  };
}

export async function materializeUiMessagesUploadedFiles(
  messages: readonly UIMessage[],
  artifactStore: ArtifactStore | undefined,
  maxUploadBytes?: number,
  artifactRecordScope?: MaterializedArtifactRecordScope,
  pendingArtifactRecords?: ArtifactRecordInsertInput[],
): Promise<UIMessage[]> {
  if (!artifactStore) {
    return messages.map((message) => ({
      ...message,
      parts: message.parts.map((part) => ({ ...part })) as UIMessage["parts"],
    }));
  }
  const nextMessages: UIMessage[] = [];
  for (const message of messages) {
    const nextParts: UIMessage["parts"] = [];
    for (const part of message.parts) {
      if (isFileMessagePart(part as TyrumUIMessagePart)) {
        nextParts.push(
          (await materializeFilePart(
            part as FileMessagePart,
            artifactStore,
            maxUploadBytes,
            artifactRecordScope,
            pendingArtifactRecords,
          )) as unknown as UIMessage["parts"][number],
        );
        continue;
      }
      nextParts.push(part);
    }
    nextMessages.push({ ...message, parts: nextParts } as UIMessage);
  }
  return nextMessages;
}

export async function materializeStoredMessageFiles(
  messages: readonly TyrumUIMessage[],
  artifactStore: ArtifactStore | undefined,
  maxUploadBytes?: number,
  artifactRecordScope?: MaterializedArtifactRecordScope,
  pendingArtifactRecords?: ArtifactRecordInsertInput[],
): Promise<TyrumUIMessage[]> {
  if (!artifactStore) {
    return messages.map((message) => ({
      ...message,
      parts: message.parts.map((part: TyrumUIMessagePart) => ({ ...part })),
    }));
  }
  const nextMessages: TyrumUIMessage[] = [];
  for (const message of messages) {
    const nextParts: TyrumUIMessagePart[] = [];
    for (const part of message.parts) {
      if (isFileMessagePart(part)) {
        nextParts.push(
          await materializeFilePart(
            part,
            artifactStore,
            maxUploadBytes,
            artifactRecordScope,
            pendingArtifactRecords,
          ),
        );
        continue;
      }
      nextParts.push(part);
    }
    nextMessages.push({ ...message, parts: nextParts });
  }
  return nextMessages;
}

export function renderTurnPartsText(parts: readonly TyrumUIMessagePart[]): string {
  const text = parts
    .filter(isTextMessagePart)
    .map((part) => part.text.trim())
    .filter((value) => value.length > 0)
    .join("\n\n")
    .trim();
  const attachments = parts.filter(isFileMessagePart).map((part) => {
    const fields = [`mime_type=${part.mediaType}`];
    if (part.filename) {
      fields.push(`filename=${part.filename}`);
    }
    return `- ${fields.join(" ")}`;
  });

  return [text, attachments.length > 0 ? `Attachments:\n${attachments.join("\n")}` : ""]
    .filter((value) => value.length > 0)
    .join("\n\n")
    .trim();
}

export function createArtifactFilePart(artifact: ArtifactRefT): FileMessagePart | undefined {
  const url = artifact.external_url?.trim();
  if (!url) {
    return undefined;
  }

  return {
    type: "file",
    url,
    mediaType: artifact.mime_type ?? "application/octet-stream",
    ...(artifact.filename ? { filename: artifact.filename } : {}),
  };
}

export function normalizeTurnParts(input: {
  envelope?: NormalizedMessageEnvelopeT;
  parts?: readonly TyrumUIMessagePart[];
}): TyrumUIMessagePart[] {
  if (input.parts && input.parts.length > 0) {
    return input.parts.map((part) => ({ ...part }));
  }

  const envelope = input.envelope;
  if (!envelope) {
    return [];
  }

  const parts: TyrumUIMessagePart[] = [];
  if (typeof envelope.content.text === "string" && envelope.content.text.trim().length > 0) {
    parts.push({ type: "text", text: envelope.content.text.trim() });
  }
  for (const attachment of envelope.content.attachments) {
    const filePart = createArtifactFilePart(attachment);
    if (filePart) {
      parts.push(filePart);
    }
  }
  return parts;
}

export function buildUserTurnMessage(input: {
  id?: string;
  parts?: readonly TyrumUIMessagePart[];
  fallbackText?: string;
}): TyrumUIMessage {
  const parts =
    input.parts && input.parts.length > 0
      ? input.parts.map((part) => ({ ...part }))
      : typeof input.fallbackText === "string" && input.fallbackText.trim().length > 0
        ? [{ type: "text" as const, text: input.fallbackText.trim() }]
        : [];
  return {
    id: input.id ?? randomUUID(),
    role: "user",
    parts,
  };
}

export function collectArtifactRefsFromValue(value: unknown): ArtifactRefT[] {
  const collected: ArtifactRefT[] = [];
  const seen = new Set<string>();

  const visit = (candidate: unknown): void => {
    const parsed = ArtifactRef.safeParse(candidate);
    if (parsed.success) {
      if (!seen.has(parsed.data.artifact_id)) {
        seen.add(parsed.data.artifact_id);
        collected.push(parsed.data);
      }
      return;
    }

    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        visit(item);
      }
      return;
    }

    if (!isRecord(candidate)) {
      return;
    }

    for (const nested of Object.values(candidate)) {
      visit(nested);
    }
  };

  visit(value);
  return collected;
}

export function collectArtifactRefsFromMessages(
  messages: readonly TyrumUIMessage[],
): ArtifactRefT[] {
  const collected: ArtifactRefT[] = [];
  const seen = new Set<string>();

  for (const message of messages) {
    for (const ref of collectArtifactRefsFromValue(message.parts)) {
      if (seen.has(ref.artifact_id)) {
        continue;
      }
      seen.add(ref.artifact_id);
      collected.push(ref);
    }
  }

  return collected;
}
