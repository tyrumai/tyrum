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
      const blockCmp = a.block.localeCompare(b.block);
      if (blockCmp !== 0) return blockCmp;
      if (a.block === "list_item" && b.block === "list_item") {
        if (a.ordered !== b.ordered) return a.ordered ? 1 : -1;
        if ((a.index ?? 0) !== (b.index ?? 0)) return (a.index ?? 0) - (b.index ?? 0);
        if (a.depth !== b.depth) return a.depth - b.depth;
      }
      if (a.block === "code_block" && b.block === "code_block") {
        return (a.language ?? "").localeCompare(b.language ?? "");
      }
      return 0;
    }

    if (a.kind === "link" && b.kind === "link") {
      return a.href.localeCompare(b.href);
    }

    if (a.kind === "style" && b.kind === "style") {
      return a.style.localeCompare(b.style);
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
        out += input.slice(idx + 2, end);
        const finish = out.length;
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
        out += input.slice(idx + 2, end);
        const finish = out.length;
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
        out += input.slice(idx + 2, end);
        const finish = out.length;
        if (finish > start) {
          spans.push({ kind: "style", style: "strike", start, end: finish });
        }
        idx = end + 2;
        continue;
      }
    }

    if (input[idx] === "*" && !input.startsWith("**", idx)) {
      const end = input.indexOf("*", idx + 1);
      if (end !== -1) {
        const start = out.length;
        out += input.slice(idx + 1, end);
        const finish = out.length;
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

function tryParseSingleFencedCodeBlock(input: string): MarkdownIr | undefined {
  if (!input.startsWith("```")) return undefined;

  const headerEnd = input.indexOf("\n");
  if (headerEnd === -1) return undefined;

  const langRaw = input.slice(3, headerEnd).trim();
  const language = langRaw.length > 0 ? langRaw : undefined;

  let fenceStart = input.indexOf("\n```", headerEnd + 1);
  if (fenceStart === -1 && input.endsWith("```")) {
    fenceStart = input.length - 3;
  }
  if (fenceStart === -1) return undefined;

  const codeRaw = input.slice(headerEnd + 1, fenceStart);
  const code = codeRaw.endsWith("\n") ? codeRaw.slice(0, -1) : codeRaw;

  if (code.length === 0) return { text: "", spans: [] };

  return {
    text: code,
    spans: [
      { kind: "block", block: "code_block", language, start: 0, end: code.length },
    ],
  };
}

function isBlockquoteBlock(raw: string): boolean {
  const lines = raw.split("\n");
  return lines.every((line) => line.trimStart().startsWith(">"));
}

function stripBlockquotePrefix(raw: string): string {
  return raw
    .split("\n")
    .map((line) => {
      const trimmed = line.trimStart();
      if (!trimmed.startsWith(">")) return line;
      const rest = trimmed.slice(1);
      return rest.startsWith(" ") ? rest.slice(1) : rest;
    })
    .join("\n");
}

function tryParseListItems(raw: string): Array<{ ordered: boolean; index?: number; depth: number; content: string }> | undefined {
  const lines = raw.split("\n");
  if (lines.length === 0) return undefined;

  const items: Array<{ ordered: boolean; index?: number; depth: number; content: string }> = [];
  let listKind: "unordered" | "ordered" | undefined;
  for (const line of lines) {
    const unorderedMatch = /^(\s*)[-+*]\s+(.*)$/.exec(line);
    if (unorderedMatch) {
      if (listKind && listKind !== "unordered") return undefined;
      listKind = "unordered";
      const indent = unorderedMatch[1] ?? "";
      const content = unorderedMatch[2] ?? "";
      const depth = Math.floor(indent.length / 2);
      items.push({ ordered: false, depth, content });
      continue;
    }

    const orderedMatch = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line);
    if (orderedMatch) {
      if (listKind && listKind !== "ordered") return undefined;
      listKind = "ordered";
      const indent = orderedMatch[1] ?? "";
      const index = Number.parseInt(orderedMatch[2] ?? "", 10);
      const content = orderedMatch[3] ?? "";
      const depth = Math.floor(indent.length / 2);
      items.push({ ordered: true, index: Number.isFinite(index) ? index : undefined, depth, content });
      continue;
    }

    return undefined;
  }
  return items.length > 0 ? items : undefined;
}

/**
 * Markdown → IR parser.
 *
 * D3 starts by establishing a deterministic IR shape (plain text + spans).
 * Rich block/link/style parsing is implemented incrementally via TDD.
 */
export function markdownToIr(markdown: string): MarkdownIr {
  const input = normalizeLineEndings(markdown ?? "");
  const codeBlock = tryParseSingleFencedCodeBlock(input);
  if (codeBlock) return { ...codeBlock, spans: sortSpans(codeBlock.spans) };

  const rawParagraphs = input.split(/\n{2,}/g);
  let text = "";
  const spans: MarkdownIrSpan[] = [];

  for (const raw of rawParagraphs) {
    const codeBlock = tryParseSingleFencedCodeBlock(raw);
    if (codeBlock) {
      if (codeBlock.text.length === 0) continue;
      if (text.length > 0) text += "\n\n";
      const start = text.length;
      text += codeBlock.text;
      for (const span of codeBlock.spans) {
        spans.push({ ...span, start: span.start + start, end: span.end + start });
      }
      continue;
    }

    const listItems = tryParseListItems(raw);
    if (listItems) {
      if (text.length > 0) text += "\n\n";
      for (let i = 0; i < listItems.length; i += 1) {
        const item = listItems[i]!;
        const inline = parseInlineMarkdown(item.content);
        if (inline.text.length === 0) continue;

        if (i > 0) text += "\n";
        const start = text.length;
        text += inline.text;
        const end = text.length;

        spans.push({
          kind: "block",
          block: "list_item",
          ordered: item.ordered,
          ...(item.index === undefined ? {} : { index: item.index }),
          depth: item.depth,
          start,
          end,
        });
        for (const span of inline.spans) {
          spans.push({ ...span, start: span.start + start, end: span.end + start });
        }
      }
      continue;
    }

    const rawBlock = isBlockquoteBlock(raw) ? stripBlockquotePrefix(raw) : raw;
    const inline = parseInlineMarkdown(rawBlock);
    if (inline.text.length === 0) continue;

    if (text.length > 0) text += "\n\n";
    const start = text.length;
    text += inline.text;
    const end = text.length;

    spans.push({
      kind: "block",
      block: isBlockquoteBlock(raw) ? "blockquote" : "paragraph",
      start,
      end,
    });
    for (const span of inline.spans) {
      spans.push({ ...span, start: span.start + start, end: span.end + start });
    }
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

    // Prefer to cut at a newline reasonably close to the end.
    let cut = text.lastIndexOf("\n", end);
    if (cut <= offset) {
      cut = text.lastIndexOf(" ", end);
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
