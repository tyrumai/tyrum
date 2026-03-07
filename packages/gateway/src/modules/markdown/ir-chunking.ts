import type { MarkdownIr, MarkdownIrSpan } from "./ir.js";

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
    return spanEnd <= spanStart
      ? []
      : [{ ...span, start: spanStart - start, end: spanEnd - start }];
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
