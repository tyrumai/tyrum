export type MarkdownIrStyle = "bold" | "italic" | "strike" | "inline_code" | "spoiler";

export type MarkdownIrSpan =
  | { kind: "block"; block: "paragraph"; start: number; end: number }
  | { kind: "block"; block: "blockquote"; start: number; end: number }
  | {
      kind: "block";
      block: "list_item";
      start: number;
      end: number;
      ordered: boolean;
      depth: number;
      index?: number;
    }
  | { kind: "block"; block: "code_block"; start: number; end: number; language?: string }
  | { kind: "style"; style: MarkdownIrStyle; start: number; end: number }
  | { kind: "link"; start: number; end: number; href: string };

export type MarkdownIr = { text: string; spans: MarkdownIrSpan[] };

function sortSpans(spans: MarkdownIrSpan[]): MarkdownIrSpan[] {
  const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

  const kindRank = (span: MarkdownIrSpan): number => {
    switch (span.kind) {
      case "block":
        return 0;
      case "link":
        return 1;
      case "style":
        return 2;
    }
  };

  return spans.toSorted((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    if (a.end !== b.end) return b.end - a.end;

    const kindCmp = kindRank(a) - kindRank(b);
    if (kindCmp !== 0) return kindCmp;

    if (a.kind === "block" && b.kind === "block") {
      const blockCmp = compareStrings(a.block, b.block);
      if (blockCmp !== 0) return blockCmp;
      if (a.block === "list_item" && b.block === "list_item") {
        if (a.ordered !== b.ordered) return a.ordered ? 1 : -1;
        if ((a.index ?? 0) !== (b.index ?? 0)) return (a.index ?? 0) - (b.index ?? 0);
        if (a.depth !== b.depth) return a.depth - b.depth;
      }
      if (a.block === "code_block" && b.block === "code_block") {
        return compareStrings(a.language ?? "", b.language ?? "");
      }
      return 0;
    }

    if (a.kind === "link" && b.kind === "link") {
      return compareStrings(a.href, b.href);
    }

    if (a.kind === "style" && b.kind === "style") {
      return compareStrings(a.style, b.style);
    }

    return 0;
  });
}

function normalizeLineEndings(input: string): string {
  return input.replace(/\r\n?/g, "\n");
}

type InlineParseResult = { text: string; spans: MarkdownIrSpan[] };
type InlineParseMatch = InlineParseResult & { next: number };

const unorderedListPattern = /^(\s*)[-+*]\s+(.*)$/;
const orderedListPattern = /^(\s*)(\d+)[.)]\s+(.*)$/;

function appendShiftedSpans(target: MarkdownIrSpan[], source: MarkdownIrSpan[], offset: number): void {
  for (const span of source) target.push({ ...span, start: span.start + offset, end: span.end + offset });
}

function findItalicEnd(input: string, start: number): number {
  for (let i = start + 1; i < input.length; i += 1) {
    if (input[i] !== "*" || input[i - 1] === "*" || input[i + 1] === "*") continue;
    return i;
  }
  return -1;
}

function matchWrappedInline(
  input: string,
  idx: number,
  marker: string,
  outer: Pick<Extract<MarkdownIrSpan, { kind: "style" }>, "kind" | "style"> | Pick<Extract<MarkdownIrSpan, { kind: "link" }>, "kind" | "href">,
  end = input.indexOf(marker, idx + marker.length),
): InlineParseMatch | undefined {
  if (!input.startsWith(marker, idx) || end === -1) return undefined;
  const inner = parseInlineMarkdown(input.slice(idx + marker.length, end));
  if (inner.text.length > 0) inner.spans.push({ ...outer, start: 0, end: inner.text.length });
  return { ...inner, next: end + marker.length };
}

function matchCodeInline(input: string, idx: number): InlineParseMatch | undefined {
  if (input[idx] !== "`") return undefined;
  const end = input.indexOf("`", idx + 1);
  if (end === -1) return undefined;
  const text = input.slice(idx + 1, end);
  return { text, spans: text.length > 0 ? [{ kind: "style", style: "inline_code", start: 0, end: text.length }] : [], next: end + 1 };
}

function matchLinkInline(input: string, idx: number): InlineParseMatch | undefined {
  if (input[idx] !== "[") return undefined;
  const labelEnd = input.indexOf("]", idx + 1);
  if (labelEnd === -1 || input[labelEnd + 1] !== "(") return undefined;
  const hrefEnd = input.indexOf(")", labelEnd + 2);
  if (hrefEnd === -1) return undefined;
  const label = parseInlineMarkdown(input.slice(idx + 1, labelEnd));
  if (label.text.length > 0) {
    label.spans.push({ kind: "link", href: input.slice(labelEnd + 2, hrefEnd).trim(), start: 0, end: label.text.length });
  }
  return { ...label, next: hrefEnd + 1 };
}

function parseInlineMarkdown(input: string): InlineParseResult {
  let out = "";
  const spans: MarkdownIrSpan[] = [];

  let idx = 0;
  while (idx < input.length) {
    const match =
      matchCodeInline(input, idx) ??
      matchLinkInline(input, idx) ??
      matchWrappedInline(input, idx, "||", { kind: "style", style: "spoiler" }) ??
      matchWrappedInline(input, idx, "**", { kind: "style", style: "bold" }) ??
      matchWrappedInline(input, idx, "~~", { kind: "style", style: "strike" }) ??
      matchWrappedInline(input, idx, "*", { kind: "style", style: "italic" }, findItalicEnd(input, idx));
    if (match) {
      const start = out.length;
      out += match.text;
      appendShiftedSpans(spans, match.spans, start);
      idx = match.next;
      continue;
    }

    out += input[idx]!;
    idx += 1;
  }

  return { text: out, spans };
}

type MarkdownBlockSeparator = "" | "\n" | "\n\n";

type MarkdownBlock =
  | { kind: "paragraph"; raw: string }
  | { kind: "blockquote"; raw: string }
  | { kind: "list_item"; ordered: boolean; index?: number; depth: number; raw: string }
  | { kind: "code_block"; language?: string; code: string };

type MarkdownBlockWithSeparator = MarkdownBlock & { sepBefore: MarkdownBlockSeparator };

function parseListBlock(line: string): Extract<MarkdownBlock, { kind: "list_item" }> | undefined {
  const ordered = orderedListPattern.exec(line);
  if (ordered) {
    const parsedIndex = Number.parseInt(ordered[2] ?? "", 10);
    return { kind: "list_item", ordered: true, index: Number.isFinite(parsedIndex) ? parsedIndex : undefined, depth: Math.floor((ordered[1] ?? "").length / 2), raw: ordered[3] ?? "" };
  }
  const unordered = unorderedListPattern.exec(line);
  if (!unordered) return undefined;
  return { kind: "list_item", ordered: false, depth: Math.floor((unordered[1] ?? "").length / 2), raw: unordered[2] ?? "" };
}

function isBlockStarter(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith("```") || trimmed.startsWith(">") || parseListBlock(line) !== undefined;
}

function scanBlocks(input: string): MarkdownBlockWithSeparator[] {
  const lines = input.split("\n");
  const blocks: MarkdownBlockWithSeparator[] = [];
  let nextSep: MarkdownBlockSeparator | undefined;

  const pushBlock = (block: MarkdownBlock): void => {
    const prev = blocks.at(-1);
    const sepBefore = !prev ? "" : nextSep === "\n\n" ? "\n\n" : prev.kind === "list_item" && block.kind === "list_item" ? "\n" : "\n\n";
    blocks.push({ ...block, sepBefore });
    nextSep = undefined;
  };

  let idx = 0;
  while (idx < lines.length) {
    const line = lines[idx]!;

    if (line.trim().length === 0) {
      nextSep = "\n\n";
      idx += 1;
      continue;
    }

    const trimmedStart = line.trimStart();

    if (trimmedStart.startsWith("```")) {
      const langRaw = trimmedStart.slice(3).trim();
      const language = langRaw.length > 0 ? langRaw : undefined;

      idx += 1;
      const codeLines: string[] = [];
      while (idx < lines.length) {
        const codeLine = lines[idx]!;
        if (codeLine.trimStart().startsWith("```")) {
          idx += 1;
          break;
        }
        codeLines.push(codeLine);
        idx += 1;
      }

      pushBlock({ kind: "code_block", language, code: codeLines.join("\n") });
      continue;
    }

    if (trimmedStart.startsWith(">")) {
      const quoteLines: string[] = [];
      while (idx < lines.length) {
        const quoteLine = lines[idx]!;
        const quoteTrimmed = quoteLine.trimStart();
        if (!quoteTrimmed.startsWith(">")) break;
        let rest = quoteTrimmed.slice(1);
        if (rest.startsWith(" ")) rest = rest.slice(1);
        quoteLines.push(rest);
        idx += 1;
      }
      pushBlock({ kind: "blockquote", raw: quoteLines.join("\n") });
      continue;
    }

    const firstListItem = parseListBlock(line);
    if (firstListItem) {
      while (idx < lines.length) {
        const listLine = lines[idx]!;
        if (listLine.trim().length === 0) break;
        const listItem = parseListBlock(listLine);
        if (!listItem || listItem.ordered !== firstListItem.ordered) break;
        pushBlock(listItem);
        idx += 1;
      }
      continue;
    }

    const paragraphLines: string[] = [];
    while (idx < lines.length) {
      const paragraphLine = lines[idx]!;
      if (paragraphLine.trim().length === 0 || isBlockStarter(paragraphLine)) break;
      paragraphLines.push(paragraphLine);
      idx += 1;
    }

    if (paragraphLines.length > 0) {
      pushBlock({ kind: "paragraph", raw: paragraphLines.join("\n") });
      continue;
    }

    pushBlock({ kind: "paragraph", raw: line });
    idx += 1;
  }

  return blocks;
}

export function markdownToIr(markdown: string): MarkdownIr {
  const input = normalizeLineEndings(markdown ?? "");
  let text = "";
  const spans: MarkdownIrSpan[] = [];
  let prevEmittedKind: MarkdownBlock["kind"] | undefined;
  let pendingSep: MarkdownBlockSeparator = "";

  const maxSep = (a: MarkdownBlockSeparator, b: MarkdownBlockSeparator): MarkdownBlockSeparator => {
    if (a === "\n\n" || b === "\n\n") return "\n\n";
    if (a === "\n" || b === "\n") return "\n";
    return "";
  };
  const pushBlockSpan = (block: MarkdownBlock, start: number, end: number): void => {
    if (block.kind === "list_item") {
      spans.push({
        kind: "block",
        block: "list_item",
        ordered: block.ordered,
        ...(block.index === undefined ? {} : { index: block.index }),
        depth: block.depth,
        start,
        end,
      });
      return;
    }
    spans.push({
      kind: "block",
      block: block.kind === "blockquote" ? "blockquote" : "paragraph",
      start,
      end,
    });
  };

  for (const block of scanBlocks(input)) {
    const baseSeparator: MarkdownBlockSeparator =
      prevEmittedKind === undefined
        ? ""
        : prevEmittedKind === "list_item" && block.kind === "list_item" && block.sepBefore === "\n"
          ? "\n"
          : "\n\n";

    const separator = prevEmittedKind === undefined ? "" : maxSep(pendingSep, baseSeparator);

    if (block.kind === "code_block") {
      if (block.code.length === 0) {
        pendingSep = maxSep(pendingSep, baseSeparator);
        continue;
      }
      text += separator;
      const start = text.length;
      text += block.code;
      const end = text.length;
      spans.push({ kind: "block", block: "code_block", language: block.language, start, end });
      pendingSep = "";
      prevEmittedKind = block.kind;
      continue;
    }

    const inline = parseInlineMarkdown(block.raw);
    if (inline.text.length === 0) {
      pendingSep = maxSep(pendingSep, baseSeparator);
      continue;
    }

    text += separator;
    const start = text.length;
    text += inline.text;
    const end = text.length;
    pushBlockSpan(block, start, end);
    appendShiftedSpans(spans, inline.spans, start);
    pendingSep = "";
    prevEmittedKind = block.kind;
  }

  if (text.length === 0) return { text: "", spans: [] };
  return { text, spans: sortSpans(spans) };
}

export function irToPlainText(ir: MarkdownIr): string {
  if (ir.text.length === 0 || ir.spans.length === 0) return ir.text;

  type BlockSpan = Extract<MarkdownIrSpan, { kind: "block" }>;
  type LinkSpan = Extract<MarkdownIrSpan, { kind: "link" }>;

  const blocks = ir.spans
    .filter((span): span is BlockSpan => span.kind === "block")
    .toSorted((a, b) => a.start - b.start);
  if (blocks.length === 0) return ir.text;

  const links = ir.spans.filter((span): span is LinkSpan => span.kind === "link");

  const renderRangeWithLinks = (start: number, end: number): string => {
    const localLinks = links.filter((link) => link.start >= start && link.end <= end).toSorted((a, b) => a.start - b.start);

    let out = "";
    let cursor = start;
    for (const link of localLinks) {
      out += ir.text.slice(cursor, link.start);
      const label = ir.text.slice(link.start, link.end);
      out += label;
      const href = link.href.trim();
      if (href.length > 0) out += ` (${href})`;
      cursor = link.end;
    }
    out += ir.text.slice(cursor, end);
    return out;
  };

  const renderBlock = (span: BlockSpan): string => {
    const content = renderRangeWithLinks(span.start, span.end);
    switch (span.block) {
      case "paragraph":
        return content;
      case "blockquote": {
        return content.split("\n").map((line) => `> ${line}`).join("\n");
      }
      case "list_item": {
        const indent = "  ".repeat(Math.max(0, span.depth));
        const prefix = span.ordered ? `${String(span.index ?? 1)}. ` : "- ";
        const firstPrefix = indent + prefix;
        const continuationPrefix = " ".repeat(firstPrefix.length);
        const lines = content.split("\n");
        return lines
          .map((line, idx) => (idx === 0 ? firstPrefix : continuationPrefix) + line)
          .join("\n");
      }
      case "code_block": {
        const lang = span.language ? span.language.trim() : "";
        return `\`\`\`${lang}\n${content}\n\`\`\``;
      }
    }
  };

  let out = "";
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]!;
    if (i > 0) {
      const prev = blocks[i - 1]!;
      out += ir.text.slice(prev.end, block.start);
    }
    out += renderBlock(block);
  }
  return out;
}

export function chunkText(input: string, maxChars: number): string[] {
  const max = Math.max(1, Math.floor(maxChars));
  const text = input ?? "";
  if (text.length <= max) return [text];

  const chunks: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    const end = Math.min(text.length, offset + max);
    if (end === text.length) {
      chunks.push(text.slice(offset));
      break;
    }
    const maxFromIndex = Math.max(offset, end - 1);
    let cut = text.lastIndexOf("\n", maxFromIndex);
    if (cut <= offset) cut = text.lastIndexOf(" ", maxFromIndex);
    cut = cut <= offset ? end : cut + 1;
    chunks.push(text.slice(offset, cut));
    offset = cut;
  }

  return chunks.filter((c) => c.length > 0);
}

function sliceIr(ir: MarkdownIr, start: number, end: number): MarkdownIr {
  const text = ir.text.slice(start, end);
  if (text.length === 0) return { text: "", spans: [] };

  const spans = ir.spans.flatMap((span) => {
    const spanStart = Math.max(span.start, start);
    const spanEnd = Math.min(span.end, end);
    return spanEnd <= spanStart ? [] : [{ ...span, start: spanStart - start, end: spanEnd - start }];
  });
  return { text, spans: sortSpans(spans) };
}

function pickChunkCut(text: string, start: number, hardEnd: number): number {
  // Prefer paragraph boundaries, then newlines, then whitespace.
  const maxFromIndex = Math.max(start, hardEnd - 1);
  const paragraphFromIndex = Math.max(start, hardEnd - 2);

  let idx = text.lastIndexOf("\n\n", paragraphFromIndex);
  if (idx >= start) return idx + 2;

  idx = text.lastIndexOf("\n", maxFromIndex);
  if (idx >= start) return idx + 1;

  idx = text.lastIndexOf(" ", maxFromIndex);
  if (idx >= start) return idx + 1;

  return hardEnd;
}

function isProtectedInlineSpan(span: MarkdownIrSpan): boolean {
  if (span.kind === "style" || span.kind === "link") return true;
  if (span.kind === "block" && span.block === "code_block") return true;
  return false;
}

function avoidSplittingProtectedSpan(
  spans: MarkdownIrSpan[],
  chunkStart: number,
  hardEnd: number,
  maxLen: number,
  cut: number,
): number {
  type Interval = { start: number; end: number };

  const intervals = spans
    .filter(
      (span): span is MarkdownIrSpan & { start: number; end: number } =>
        isProtectedInlineSpan(span) &&
        span.end - span.start <= maxLen &&
        span.start < hardEnd &&
        span.end > chunkStart,
    )
    .map((span): Interval => ({ start: span.start, end: span.end }))
    .toSorted((a, b) => (a.start !== b.start ? a.start - b.start : a.end - b.end));

  if (intervals.length === 0) return cut;

  const merged: Interval[] = [];
  for (const interval of intervals) {
    const prev = merged.at(-1);
    if (!prev || interval.start >= prev.end) merged.push(interval);
    else prev.end = Math.max(prev.end, interval.end);
  }

  const container = merged.find((interval) => interval.start < cut && cut < interval.end);
  if (!container) return cut;

  if (container.start > chunkStart) return container.start;
  if (container.end <= hardEnd) return container.end;
  return cut;
}

function findMaxChunkEnd(
  ir: MarkdownIr,
  start: number,
  maxMeasure: number,
  measure: (chunk: MarkdownIr) => number,
): number {
  const textLen = ir.text.length;
  if (start >= textLen) return textLen;

  let lo = start + 1;
  let hi = textLen;
  let best = start;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (measure(sliceIr(ir, start, mid)) <= maxMeasure) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }

  return best;
}

export function chunkIr(
  ir: MarkdownIr,
  maxChars: number,
  opts?: { measure?: (chunk: MarkdownIr) => number },
): MarkdownIr[] {
  const maxMeasure = Math.max(1, Math.floor(maxChars));
  const text = ir.text ?? "";
  const measure = opts?.measure ?? ((chunk: MarkdownIr) => chunk.text.length);

  if (text.length === 0) return [];
  if (measure(ir) <= maxMeasure) return [ir];

  const chunks: MarkdownIr[] = [];
  let offset = 0;
  while (offset < text.length) {
    let hardEnd = findMaxChunkEnd(ir, offset, maxMeasure, measure);
    if (hardEnd === offset) {
      // No chunk fits the requested measure (for example: renderer overhead).
      // Fall back to chunking by underlying text length to guarantee progress.
      hardEnd = Math.min(text.length, offset + maxMeasure);
    }
    if (hardEnd >= text.length) {
      chunks.push(sliceIr(ir, offset, text.length));
      break;
    }

    let cut = pickChunkCut(text, offset, hardEnd);
    cut = avoidSplittingProtectedSpan(ir.spans, offset, hardEnd, maxMeasure, cut);

    if (cut <= offset) cut = hardEnd;
    chunks.push(sliceIr(ir, offset, cut));
    offset = cut;
  }

  return chunks;
}
