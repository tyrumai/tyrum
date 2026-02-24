import { chunkIr, chunkText, irToPlainText, markdownToIr } from "./ir.js";

const TELEGRAM_MAX_MESSAGE_CHARS = 4096;

export function renderMarkdownForTelegram(markdown: string, opts?: { maxChars?: number }): string[] {
  const maxChars = Math.max(
    1,
    Math.min(TELEGRAM_MAX_MESSAGE_CHARS, opts?.maxChars ?? 3500),
  );

  const ir = markdownToIr(markdown ?? "");
  const plain = irToPlainText(ir).trim();
  if (plain.length === 0) return [];

  if (plain.length <= maxChars) return [plain];

  const rendered = chunkIr(ir, maxChars, { measure: (chunk) => irToPlainText(chunk).length }).map(irToPlainText);

  const chunks: string[] = [];
  for (const chunk of rendered) {
    if (chunk.length === 0) continue;
    if (chunk.length <= maxChars) {
      chunks.push(chunk);
      continue;
    }
    chunks.push(...chunkText(chunk, maxChars));
  }

  return chunks.filter((chunk) => chunk.length > 0);
}
