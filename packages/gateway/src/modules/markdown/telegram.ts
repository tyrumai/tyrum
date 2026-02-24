import { chunkIr, chunkText, irToPlainText, markdownToIr } from "./ir.js";

const TELEGRAM_MAX_MESSAGE_CHARS = 4096;

export type TelegramFormattingFallbackEvent = {
  reason: "render_error" | "max_chars_overflow";
  chunk_index: number;
  detail?: string;
};

function escapeTelegramHtmlText(input: string): string {
  return (input ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeTelegramHtmlAttr(input: string): string {
  return escapeTelegramHtmlText(input).replaceAll("\"", "&quot;");
}

function sanitizeCodeLanguage(language: string | undefined): string | undefined {
  const trimmed = language?.trim();
  if (!trimmed) return undefined;
  const cleaned = trimmed.replaceAll(/[^a-zA-Z0-9_-]/g, "-").replaceAll(/-+/g, "-").replaceAll(/^-|-$/g, "");
  return cleaned.length > 0 ? cleaned : undefined;
}

function isAllowedHref(href: string): boolean {
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

type InlineSpan =
  | Extract<import("./ir.js").MarkdownIrSpan, { kind: "style" }>
  | Extract<import("./ir.js").MarkdownIrSpan, { kind: "link" }>;

type BlockSpan = Extract<import("./ir.js").MarkdownIrSpan, { kind: "block" }>;

function inlineKindRank(span: InlineSpan): number {
  return span.kind === "link" ? 0 : 1;
}

function openInlineTag(span: InlineSpan): string {
  if (span.kind === "link") {
    const href = span.href.trim();
    const safeHref = escapeTelegramHtmlAttr(href);
    return `<a href="${safeHref}">`;
  }

  switch (span.style) {
    case "bold":
      return "<b>";
    case "italic":
      return "<i>";
    case "strike":
      return "<s>";
    case "inline_code":
      return "<code>";
    case "spoiler":
      return '<span class="tg-spoiler">';
  }
}

function closeInlineTag(span: InlineSpan): string {
  if (span.kind === "link") return "</a>";

  switch (span.style) {
    case "bold":
      return "</b>";
    case "italic":
      return "</i>";
    case "strike":
      return "</s>";
    case "inline_code":
      return "</code>";
    case "spoiler":
      return "</span>";
  }
}

function renderInlineRangeToTelegramHtml(
  ir: import("./ir.js").MarkdownIr,
  start: number,
  end: number,
): string {
  const spans = ir.spans
    .filter((span): span is InlineSpan => (span.kind === "style" || span.kind === "link") && span.start >= start && span.end <= end)
    .map((span) => ({ ...span }));

  const suffixes = new Map<number, string[]>();
  const filtered: InlineSpan[] = [];
  for (const span of spans) {
    if (span.kind !== "link") {
      filtered.push(span);
      continue;
    }

    const href = span.href.trim();
    if (href.length === 0 || !isAllowedHref(href)) {
      const labelSuffix = ` (${escapeTelegramHtmlText(href)})`;
      if (labelSuffix.trim().length > 0) {
        const bucket = suffixes.get(span.end) ?? [];
        bucket.push(labelSuffix);
        suffixes.set(span.end, bucket);
      }
      continue;
    }

    filtered.push(span);
  }

  const opensByIndex = new Map<number, InlineSpan[]>();
  const closesByIndex = new Map<number, InlineSpan[]>();

  for (const span of filtered) {
    const opens = opensByIndex.get(span.start) ?? [];
    opens.push(span);
    opensByIndex.set(span.start, opens);

    const closes = closesByIndex.get(span.end) ?? [];
    closes.push(span);
    closesByIndex.set(span.end, closes);
  }

  for (const [idx, spans] of opensByIndex) {
    spans.sort((a, b) => {
      const kindCmp = inlineKindRank(a) - inlineKindRank(b);
      if (kindCmp !== 0) return kindCmp;
      if (a.end !== b.end) return b.end - a.end;
      return 0;
    });
    opensByIndex.set(idx, spans);
  }

  for (const [idx, spans] of closesByIndex) {
    spans.sort((a, b) => {
      const kindCmp = inlineKindRank(b) - inlineKindRank(a);
      if (kindCmp !== 0) return kindCmp;
      if (a.start !== b.start) return b.start - a.start;
      return 0;
    });
    closesByIndex.set(idx, spans);
  }

  let out = "";
  for (let i = start; i < end; i += 1) {
    const closes = closesByIndex.get(i);
    if (closes) {
      for (const span of closes) out += closeInlineTag(span);
    }

    const opens = opensByIndex.get(i);
    if (opens) {
      for (const span of opens) out += openInlineTag(span);
    }

    const suffix = suffixes.get(i);
    if (suffix) {
      for (const part of suffix) out += part;
    }

    out += escapeTelegramHtmlText(ir.text[i]!);
  }

  const closesAtEnd = closesByIndex.get(end);
  if (closesAtEnd) {
    for (const span of closesAtEnd) out += closeInlineTag(span);
  }

  const suffixAtEnd = suffixes.get(end);
  if (suffixAtEnd) {
    for (const part of suffixAtEnd) out += part;
  }

  return out;
}

function renderIrChunkToTelegramHtml(chunk: import("./ir.js").MarkdownIr): string {
  const text = chunk.text ?? "";
  if (text.length === 0) return "";

  const blocks = chunk.spans
    .filter((span): span is BlockSpan => span.kind === "block")
    .toSorted((a, b) => a.start - b.start);

  if (blocks.length === 0) {
    return escapeTelegramHtmlText(text);
  }

  let out = "";
  let cursor = 0;

  for (const block of blocks) {
    if (block.start > cursor) {
      out += escapeTelegramHtmlText(text.slice(cursor, block.start));
    }

    switch (block.block) {
      case "code_block": {
        const language = sanitizeCodeLanguage(block.language);
        const classAttr = language ? ` class="language-${escapeTelegramHtmlAttr(language)}"` : "";
        out += `<pre><code${classAttr}>`;
        out += escapeTelegramHtmlText(text.slice(block.start, block.end));
        out += "</code></pre>";
        break;
      }
      case "blockquote": {
        const inner = renderInlineRangeToTelegramHtml(chunk, block.start, block.end);
        out += inner
          .split("\n")
          .map((line) => `&gt; ${line}`)
          .join("\n");
        break;
      }
      case "list_item": {
        const indent = "  ".repeat(Math.max(0, block.depth));
        const prefix = block.ordered ? `${String(block.index ?? 1)}. ` : "- ";
        const firstPrefix = indent + prefix;
        const continuationPrefix = " ".repeat(firstPrefix.length);
        const inner = renderInlineRangeToTelegramHtml(chunk, block.start, block.end);
        const lines = inner.split("\n");
        out += lines
          .map((line, idx) => (idx === 0 ? firstPrefix : continuationPrefix) + line)
          .join("\n");
        break;
      }
      case "paragraph": {
        out += renderInlineRangeToTelegramHtml(chunk, block.start, block.end);
        break;
      }
    }

    cursor = block.end;
  }

  if (cursor < text.length) {
    out += escapeTelegramHtmlText(text.slice(cursor));
  }

  return out;
}

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

export function renderMarkdownForTelegram(
  markdown: string,
  opts?: {
    maxChars?: number;
    onFormattingFallback?: (event: TelegramFormattingFallbackEvent) => void;
  },
): string[] {
  const maxChars = Math.max(
    1,
    Math.min(TELEGRAM_MAX_MESSAGE_CHARS, opts?.maxChars ?? 3500),
  );

  const ir = markdownToIr(markdown ?? "");
  const plain = irToPlainText(ir).trim();
  if (plain.length === 0) return [];

  const safeMeasure = (chunk: import("./ir.js").MarkdownIr): number => {
    try {
      return renderIrChunkToTelegramHtml(chunk).length;
    } catch {
      return maxChars + 1;
    }
  };

  const chunksIr = chunkIr(ir, maxChars, { measure: safeMeasure });

  const chunks: string[] = [];
  for (let i = 0; i < chunksIr.length; i += 1) {
    const chunkIr = chunksIr[i]!;
    let rendered: string | undefined;
    try {
      rendered = renderIrChunkToTelegramHtml(chunkIr);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      opts?.onFormattingFallback?.({ reason: "render_error", chunk_index: i, detail: message });
    }

    if (rendered && rendered.length > 0 && rendered.length <= maxChars) {
      chunks.push(rendered);
      continue;
    }

    if (rendered && rendered.length > maxChars) {
      opts?.onFormattingFallback?.({ reason: "max_chars_overflow", chunk_index: i });
    }

    const fallbackPlain = irToPlainText(chunkIr);
    if (fallbackPlain.length === 0) continue;

    const fallbackChunks = fallbackPlain.length <= maxChars ? [fallbackPlain] : chunkText(fallbackPlain, maxChars);
    for (const fallbackChunk of fallbackChunks) {
      if (fallbackChunk.length === 0) continue;
      if (fallbackChunk.length <= maxChars) {
        chunks.push(escapeTelegramHtmlText(fallbackChunk));
        continue;
      }
      // Last-ditch: ensure we always make progress even when escaping overhead
      // or formatting wrappers exceed `maxChars`.
      chunks.push(...chunkText(escapeTelegramHtmlText(fallbackChunk), maxChars));
    }
  }

  return trimOuterWhitespaceChunks(chunks);
}
