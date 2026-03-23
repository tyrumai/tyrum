import type { AttachmentUserContentPart } from "./attachment-analysis.js";

export function mergeAutomationContextSections(
  metadataSection: string | undefined,
  digestBody: string | undefined,
): string | undefined {
  const sections: string[] = [];
  if (metadataSection) {
    const normalized = metadataSection.replace(/^Automation context:\n?/, "").trim();
    if (normalized.length > 0) {
      sections.push(normalized);
    }
  }
  if (digestBody) {
    const normalized = digestBody.trim();
    if (normalized.length > 0) {
      sections.push(normalized);
    }
  }
  if (sections.length === 0) {
    return undefined;
  }
  return `Automation context:\n${sections.join("\n\n")}`;
}

export function buildCurrentTurnUserContent(
  resolvedMessage: string,
  currentTurnParts: readonly AttachmentUserContentPart[],
): AttachmentUserContentPart[] {
  if (currentTurnParts.length === 0) {
    return [{ type: "text", text: resolvedMessage }];
  }

  const hasFilePart = currentTurnParts.some((part) => part.type === "file");
  if (hasFilePart) {
    return [...currentTurnParts];
  }

  const hasNonEmptyTextPart = currentTurnParts.some(
    (part) => part.type === "text" && part.text.trim().length > 0,
  );
  if (hasNonEmptyTextPart) {
    return [...currentTurnParts];
  }

  return [{ type: "text", text: resolvedMessage }, ...currentTurnParts];
}
