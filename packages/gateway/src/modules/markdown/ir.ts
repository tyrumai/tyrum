export type MarkdownIrNode =
  | { kind: "text"; text: string }
  | { kind: "code_block"; language?: string; code: string };

function pushText(nodes: MarkdownIrNode[], text: string): void {
  if (text.length === 0) return;
  const prev = nodes[nodes.length - 1];
  if (prev && prev.kind === "text") {
    prev.text += text;
    return;
  }
  nodes.push({ kind: "text", text });
}

/**
 * Minimal Markdown → IR parser.
 *
 * This intentionally supports only fenced code blocks as structured nodes.
 * Everything else is treated as plain text.
 */
export function markdownToIr(markdown: string): MarkdownIrNode[] {
  const input = markdown ?? "";
  const nodes: MarkdownIrNode[] = [];

  let idx = 0;
  while (idx < input.length) {
    const fenceStart = input.indexOf("```", idx);
    if (fenceStart === -1) {
      pushText(nodes, input.slice(idx));
      break;
    }

    pushText(nodes, input.slice(idx, fenceStart));
    idx = fenceStart + 3;

    // Optional language id until first newline.
    let language: string | undefined;
    const newline = input.indexOf("\n", idx);
    if (newline === -1) {
      // No newline -> treat remainder as text.
      pushText(nodes, "```" + input.slice(idx));
      break;
    }

    const langRaw = input.slice(idx, newline).trim();
    language = langRaw.length > 0 ? langRaw : undefined;
    idx = newline + 1;

    const fenceEnd = input.indexOf("```", idx);
    if (fenceEnd === -1) {
      // Unclosed fence; treat as text.
      pushText(nodes, "```" + (language ? language + "\n" : "\n") + input.slice(idx));
      break;
    }

    const code = input.slice(idx, fenceEnd);
    nodes.push({ kind: "code_block", language, code });
    idx = fenceEnd + 3;
  }

  return nodes;
}

export function irToPlainText(nodes: MarkdownIrNode[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.kind === "text") {
      out += node.text;
      continue;
    }
    const lang = node.language ? node.language : "";
    out += `\n\`\`\`${lang}\n${node.code}\n\`\`\`\n`;
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

