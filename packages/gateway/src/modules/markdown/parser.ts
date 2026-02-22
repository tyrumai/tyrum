/**
 * Minimal Markdown -> IR parser.
 *
 * Supports: headings, paragraphs, code blocks (fenced), inline code,
 * unordered/ordered lists, bold, italic, links, and horizontal rules.
 */

export type IrNodeKind =
  | "heading"
  | "paragraph"
  | "code_block"
  | "list"
  | "list_item"
  | "horizontal_rule"
  | "text"
  | "bold"
  | "italic"
  | "code_inline"
  | "link";

export interface IrNode {
  kind: IrNodeKind;
  content?: string;
  children?: IrNode[];
  level?: number; // for headings (1-6)
  language?: string; // for code blocks
  ordered?: boolean; // for lists
  url?: string; // for links
}

export const CODE_FENCE_START_RE = /^```(\w*)$/;

export function parseMarkdown(text: string): IrNode[] {
  const lines = text.split("\n");
  const nodes: IrNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Empty line — skip
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      nodes.push({ kind: "horizontal_rule" });
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      nodes.push({
        kind: "heading",
        level: headingMatch[1]!.length,
        children: parseInline(headingMatch[2]!),
      });
      i++;
      continue;
    }

    // Fenced code block
    const codeMatch = line.match(CODE_FENCE_START_RE);
    if (codeMatch) {
      const language = codeMatch[1] || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) {
        codeLines.push(lines[i]!);
        i++;
      }
      if (i < lines.length) i++; // skip closing ```
      nodes.push({
        kind: "code_block",
        content: codeLines.join("\n"),
        language,
      });
      continue;
    }

    // Unordered list
    if (/^[-*+]\s/.test(line)) {
      const items: IrNode[] = [];
      while (i < lines.length && /^[-*+]\s/.test(lines[i]!)) {
        const itemText = lines[i]!.replace(/^[-*+]\s/, "");
        items.push({ kind: "list_item", children: parseInline(itemText) });
        i++;
      }
      nodes.push({ kind: "list", ordered: false, children: items });
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items: IrNode[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i]!)) {
        const itemText = lines[i]!.replace(/^\d+\.\s/, "");
        items.push({ kind: "list_item", children: parseInline(itemText) });
        i++;
      }
      nodes.push({ kind: "list", ordered: true, children: items });
      continue;
    }

    // Paragraph (collect consecutive non-blank lines that aren't block-level)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !/^#{1,6}\s/.test(lines[i]!) &&
      !/^```/.test(lines[i]!) &&
      !/^[-*+]\s/.test(lines[i]!) &&
      !/^\d+\.\s/.test(lines[i]!) &&
      !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i]!)
    ) {
      paraLines.push(lines[i]!);
      i++;
    }
    if (paraLines.length > 0) {
      nodes.push({
        kind: "paragraph",
        children: parseInline(paraLines.join("\n")),
      });
    }
  }

  return nodes;
}

/**
 * Parse inline formatting: bold, italic, code, links.
 */
export function parseInline(text: string): IrNode[] {
  const nodes: IrNode[] = [];
  const regex =
    /(\*\*(.+?)\*\*|__(.+?)__|\*(.+?)\*|_(.+?)_|`(.+?)`|\[(.+?)\]\((.+?)\))/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      nodes.push({
        kind: "text",
        content: text.slice(lastIndex, match.index),
      });
    }

    if (match[2] ?? match[3]) {
      // Bold (**text** or __text__)
      nodes.push({ kind: "bold", content: match[2] ?? match[3] });
    } else if (match[4] ?? match[5]) {
      // Italic (*text* or _text_)
      nodes.push({ kind: "italic", content: match[4] ?? match[5] });
    } else if (match[6]) {
      // Inline code
      nodes.push({ kind: "code_inline", content: match[6] });
    } else if (match[7] && match[8]) {
      // Link
      nodes.push({ kind: "link", content: match[7], url: match[8] });
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    nodes.push({ kind: "text", content: text.slice(lastIndex) });
  }

  return nodes;
}
