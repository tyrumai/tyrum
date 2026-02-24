export type MarkdownIrStyle = "bold" | "italic" | "strike" | "inline_code" | "spoiler";

export type MarkdownIrSpan =
  | { kind: "block"; block: "paragraph"; start: number; end: number }
  | { kind: "block"; block: "blockquote"; start: number; end: number }
  | { kind: "block"; block: "list_item"; start: number; end: number; ordered: boolean; depth: number; index?: number }
  | { kind: "block"; block: "code_block"; start: number; end: number; language?: string }
  | { kind: "style"; style: MarkdownIrStyle; start: number; end: number }
  | { kind: "link"; start: number; end: number; href: string };

export type MarkdownIr = {
  text: string;
  spans: MarkdownIrSpan[];
};

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

function parseInlineMarkdown(input: string): { text: string; spans: MarkdownIrSpan[] } {
  let out = "";
  const spans: MarkdownIrSpan[] = [];

  let idx = 0;
  while (idx < input.length) {
    if (input[idx] === "`") {
      const end = input.indexOf("`", idx + 1);
      if (end !== -1) {
        const start = out.length;
        out += input.slice(idx + 1, end);
        const finish = out.length;
        if (finish > start) {
          spans.push({ kind: "style", style: "inline_code", start, end: finish });
        }
        idx = end + 1;
        continue;
      }
    }

    if (input[idx] === "[") {
      const labelEnd = input.indexOf("]", idx + 1);
      if (labelEnd !== -1 && input[labelEnd + 1] === "(") {
        const hrefEnd = input.indexOf(")", labelEnd + 2);
        if (hrefEnd !== -1) {
          const labelRaw = input.slice(idx + 1, labelEnd);
          const href = input.slice(labelEnd + 2, hrefEnd).trim();

          const start = out.length;
          const label = parseInlineMarkdown(labelRaw);
          out += label.text;
          const finish = out.length;
          for (const span of label.spans) {
            spans.push({ ...span, start: span.start + start, end: span.end + start });
          }
          if (finish > start) {
            spans.push({ kind: "link", start, end: finish, href });
          }

          idx = hrefEnd + 1;
          continue;
        }
      }
    }

    if (input.startsWith("||", idx)) {
      const end = input.indexOf("||", idx + 2);
      if (end !== -1) {
        const start = out.length;
        const inner = parseInlineMarkdown(input.slice(idx + 2, end));
        out += inner.text;
        const finish = out.length;
        for (const span of inner.spans) {
          spans.push({ ...span, start: span.start + start, end: span.end + start });
        }
        if (finish > start) {
          spans.push({ kind: "style", style: "spoiler", start, end: finish });
        }
        idx = end + 2;
        continue;
      }
    }

    if (input.startsWith("**", idx)) {
      const end = input.indexOf("**", idx + 2);
      if (end !== -1) {
        const start = out.length;
        const inner = parseInlineMarkdown(input.slice(idx + 2, end));
        out += inner.text;
        const finish = out.length;
        for (const span of inner.spans) {
          spans.push({ ...span, start: span.start + start, end: span.end + start });
        }
        if (finish > start) {
          spans.push({ kind: "style", style: "bold", start, end: finish });
        }
        idx = end + 2;
        continue;
      }
    }

    if (input.startsWith("~~", idx)) {
      const end = input.indexOf("~~", idx + 2);
      if (end !== -1) {
        const start = out.length;
        const inner = parseInlineMarkdown(input.slice(idx + 2, end));
        out += inner.text;
        const finish = out.length;
        for (const span of inner.spans) {
          spans.push({ ...span, start: span.start + start, end: span.end + start });
        }
        if (finish > start) {
          spans.push({ kind: "style", style: "strike", start, end: finish });
        }
        idx = end + 2;
        continue;
      }
    }

    if (input[idx] === "*" && !input.startsWith("**", idx)) {
      let end = -1;
      for (let i = idx + 1; i < input.length; i += 1) {
        if (input[i] !== "*") continue;
        if (input[i - 1] === "*" || input[i + 1] === "*") continue;
        end = i;
        break;
      }
      if (end !== -1) {
        const start = out.length;
        const inner = parseInlineMarkdown(input.slice(idx + 1, end));
        out += inner.text;
        const finish = out.length;
        for (const span of inner.spans) {
          spans.push({ ...span, start: span.start + start, end: span.end + start });
        }
        if (finish > start) {
          spans.push({ kind: "style", style: "italic", start, end: finish });
        }
        idx = end + 1;
        continue;
      }
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

function scanBlocks(input: string): MarkdownBlockWithSeparator[] {
  const lines = input.split("\n");
  const blocks: MarkdownBlockWithSeparator[] = [];
  let nextSep: MarkdownBlockSeparator | undefined;

  const pushBlock = (block: MarkdownBlock): void => {
    let sepBefore: MarkdownBlockSeparator = "";
    if (blocks.length === 0) {
      sepBefore = "";
    } else if (nextSep === "\n\n") {
      sepBefore = "\n\n";
    } else {
      const prev = blocks[blocks.length - 1]!;
      sepBefore = prev.kind === "list_item" && block.kind === "list_item" ? "\n" : "\n\n";
    }

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

    const unorderedMatch = /^(\s*)[-+*]\s+(.*)$/.exec(line);
    const orderedMatch = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line);
    if (unorderedMatch || orderedMatch) {
      const listKind: "unordered" | "ordered" = orderedMatch ? "ordered" : "unordered";
      while (idx < lines.length) {
        const listLine = lines[idx]!;
        if (listLine.trim().length === 0) break;

        const unordered = /^(\s*)[-+*]\s+(.*)$/.exec(listLine);
        const ordered = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(listLine);

        if (listKind === "unordered") {
          if (!unordered) break;
          const indent = unordered[1] ?? "";
          const depth = Math.floor(indent.length / 2);
          const raw = unordered[2] ?? "";
          pushBlock({ kind: "list_item", ordered: false, depth, raw });
          idx += 1;
          continue;
        }

        if (!ordered) break;
        const indent = ordered[1] ?? "";
        const depth = Math.floor(indent.length / 2);
        const parsedIndex = Number.parseInt(ordered[2] ?? "", 10);
        const index = Number.isFinite(parsedIndex) ? parsedIndex : undefined;
        const raw = ordered[3] ?? "";
        pushBlock({ kind: "list_item", ordered: true, index, depth, raw });
        idx += 1;
      }
      continue;
    }

    const paragraphLines: string[] = [];
    while (idx < lines.length) {
      const paragraphLine = lines[idx]!;
      if (paragraphLine.trim().length === 0) break;

      const paragraphTrimmed = paragraphLine.trimStart();
      if (
        paragraphTrimmed.startsWith("```")
        || paragraphTrimmed.startsWith(">")
        || /^(\s*)[-+*]\s+/.test(paragraphLine)
        || /^(\s*)(\d+)[.)]\s+/.test(paragraphLine)
      ) {
        break;
      }

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

/**
 * Markdown → IR parser.
 *
 * D3 starts by establishing a deterministic IR shape (plain text + spans).
 * Rich block/link/style parsing is implemented incrementally via TDD.
 */
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
    } else if (block.kind === "blockquote") {
      spans.push({ kind: "block", block: "blockquote", start, end });
    } else {
      spans.push({ kind: "block", block: "paragraph", start, end });
    }

    for (const span of inline.spans) {
      spans.push({ ...span, start: span.start + start, end: span.end + start });
    }
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

  const blocks = ir.spans.filter((span): span is BlockSpan => span.kind === "block").toSorted((a, b) => a.start - b.start);
  if (blocks.length === 0) return ir.text;

  const links = ir.spans.filter((span): span is LinkSpan => span.kind === "link");

  const renderRangeWithLinks = (start: number, end: number): string => {
    const localLinks = links
      .filter((link) => link.start >= start && link.end <= end)
      .toSorted((a, b) => a.start - b.start);

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
        return content
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n");
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

    // Prefer to cut at a newline reasonably close to the end.
    let cut = text.lastIndexOf("\n", maxFromIndex);
    if (cut <= offset) {
      cut = text.lastIndexOf(" ", maxFromIndex);
    }
    if (cut <= offset) {
      cut = end;
    } else {
      cut += 1; // include delimiter
    }

    chunks.push(text.slice(offset, cut));
    offset = cut;
  }

  return chunks.filter((c) => c.length > 0);
}

function sliceIr(ir: MarkdownIr, start: number, end: number): MarkdownIr {
  const text = ir.text.slice(start, end);
  if (text.length === 0) return { text: "", spans: [] };

  const spans: MarkdownIrSpan[] = [];
  for (const span of ir.spans) {
    const spanStart = Math.max(span.start, start);
    const spanEnd = Math.min(span.end, end);
    if (spanEnd <= spanStart) continue;
    spans.push({ ...span, start: spanStart - start, end: spanEnd - start });
  }

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
    if (!prev || interval.start >= prev.end) {
      merged.push(interval);
      continue;
    }
    prev.end = Math.max(prev.end, interval.end);
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
    const candidate = sliceIr(ir, start, mid);
    if (measure(candidate) <= maxMeasure) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
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

  if (text.length === 0) return [{ text: "", spans: [] }];
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
