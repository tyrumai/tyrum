import { chunkIr, irToPlainText, markdownToIr } from "./ir.js";

const TELEGRAM_MAX_MESSAGE_CHARS = 4096;

export function renderMarkdownForTelegram(markdown: string, opts?: { maxChars?: number }): string[] {
  const maxChars = Math.max(
    1,
    Math.min(TELEGRAM_MAX_MESSAGE_CHARS, opts?.maxChars ?? 3500),
  );

  const ir = markdownToIr(markdown ?? "");
  const plain = irToPlainText(ir).trim();
  if (plain.length === 0) return [];

  return chunkIr(ir, maxChars, { measure: (chunk) => irToPlainText(chunk).length })
    .map(irToPlainText)
    .filter((chunk) => chunk.trim().length > 0);
}
