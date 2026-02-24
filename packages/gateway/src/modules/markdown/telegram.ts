import { chunkIr, chunkText, irToPlainText, markdownToIr } from "./ir.js";

const TELEGRAM_MAX_MESSAGE_CHARS = 4096;

function trimOuterWhitespaceChunks(chunks: string[]): string[] {
  const out = chunks.filter((chunk) => chunk.length > 0);

  while (out.length > 0) {
    const trimmed = out[0]!.trimStart();
    if (trimmed.length === 0) {
      out.shift();
      continue;
    }
    out[0] = trimmed;
    break;
  }

  while (out.length > 0) {
    const idx = out.length - 1;
    const trimmed = out[idx]!.trimEnd();
    if (trimmed.length === 0) {
      out.pop();
      continue;
    }
    out[idx] = trimmed;
    break;
  }

  return out;
}

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

  return trimOuterWhitespaceChunks(chunks);
}
