import type {
  NormalizedAttachment as NormalizedAttachmentT,
  NormalizedMessageEnvelope as NormalizedMessageEnvelopeT,
  NormalizedThreadMessage as NormalizedThreadMessageT,
} from "@tyrum/schemas";

function formatNormalizedAttachment(attachment: NormalizedAttachmentT): string {
  const fields = [`kind=${attachment.kind}`];
  if (attachment.mime_type) fields.push(`mime_type=${attachment.mime_type}`);
  if (typeof attachment.size_bytes === "number") {
    fields.push(`size_bytes=${String(attachment.size_bytes)}`);
  }
  if (attachment.sha256) fields.push(`sha256=${attachment.sha256}`);
  return `- ${fields.join(" ")}`;
}

function formatAttachmentSummary(attachments: NormalizedAttachmentT[]): string | undefined {
  if (!attachments || attachments.length === 0) return undefined;
  return `Attachments:\n${attachments.map(formatNormalizedAttachment).join("\n")}`;
}

export function renderEnvelopeMessageText(input: {
  envelope?: NormalizedMessageEnvelopeT;
  fallbackText?: string;
}): string {
  const baseText = (input.fallbackText ?? "").trim();
  const attachmentsSummary = input.envelope
    ? formatAttachmentSummary(input.envelope.content.attachments)
    : undefined;

  return [baseText, attachmentsSummary]
    .filter((part) => part && part.trim().length > 0)
    .join("\n\n")
    .trim();
}

export function renderNormalizedThreadMessageText(input: NormalizedThreadMessageT): string {
  const fallbackText =
    input.message.content.kind === "text"
      ? input.message.content.text
      : (input.message.content.caption ?? "");
  return renderEnvelopeMessageText({
    envelope: input.message.envelope,
    fallbackText,
  });
}
