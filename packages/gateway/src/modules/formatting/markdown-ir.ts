export type MarkdownToken =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "strike"; text: string }
  | { kind: "code_inline"; text: string }
  | { kind: "link"; text: string; href: string }
  | { kind: "code_block"; text: string; lang?: string };

function takeUntil(input: string, start: number, needle: string): number {
  return input.indexOf(needle, start);
}

function pushText(out: MarkdownToken[], text: string): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.kind === "text") {
    last.text += text;
    return;
  }
  out.push({ kind: "text", text });
}

export function parseMarkdownToIr(markdown: string): MarkdownToken[] {
  const out: MarkdownToken[] = [];
  const lines = markdown.split("\n");

  let inFence = false;
  let fenceLang: string | undefined;
  let fenceLines: string[] = [];

  const flushFence = (): void => {
    out.push({
      kind: "code_block",
      text: fenceLines.join("\n"),
      lang: fenceLang,
    });
    fenceLines = [];
    fenceLang = undefined;
  };

  const inlineBuffer: string[] = [];
  const flushInline = (): void => {
    if (inlineBuffer.length === 0) return;
    const text = inlineBuffer.join("\n");
    inlineBuffer.length = 0;
    out.push(...parseInline(text));
  };

  for (const line of lines) {
    const trimmed = line.trimStart();
    const isFence = trimmed.startsWith("```");

    if (isFence) {
      if (!inFence) {
        flushInline();
        inFence = true;
        const lang = trimmed.slice(3).trim();
        fenceLang = lang.length > 0 ? lang : undefined;
      } else {
        inFence = false;
        flushFence();
      }
      continue;
    }

    if (inFence) {
      fenceLines.push(line);
    } else {
      inlineBuffer.push(line);
    }
  }

  if (inFence) {
    // Unclosed fence: treat opening marker as literal and merge into text.
    flushInline();
    out.push({
      kind: "code_block",
      text: fenceLines.join("\n"),
      lang: fenceLang,
    });
  } else {
    flushInline();
  }

  // Normalise: avoid empty trailing text token.
  if (out.length > 0) {
    const last = out[out.length - 1];
    if (last?.kind === "text" && last.text.length === 0) {
      out.pop();
    }
  }

  return out;
}

function parseInline(text: string): MarkdownToken[] {
  const out: MarkdownToken[] = [];
  let buffer = "";

  const flush = (): void => {
    pushText(out, buffer);
    buffer = "";
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;

    // Inline code
    if (ch === "`") {
      const end = takeUntil(text, i + 1, "`");
      if (end !== -1) {
        flush();
        out.push({ kind: "code_inline", text: text.slice(i + 1, end) });
        i = end;
        continue;
      }
    }

    // Bold
    if (ch === "*" && text[i + 1] === "*") {
      const end = takeUntil(text, i + 2, "**");
      if (end !== -1) {
        flush();
        out.push({ kind: "bold", text: text.slice(i + 2, end) });
        i = end + 1;
        continue;
      }
    }

    // Strike
    if (ch === "~" && text[i + 1] === "~") {
      const end = takeUntil(text, i + 2, "~~");
      if (end !== -1) {
        flush();
        out.push({ kind: "strike", text: text.slice(i + 2, end) });
        i = end + 1;
        continue;
      }
    }

    // Italic (single *)
    if (ch === "*") {
      const end = takeUntil(text, i + 1, "*");
      if (end !== -1 && text[i + 1] !== "*") {
        flush();
        out.push({ kind: "italic", text: text.slice(i + 1, end) });
        i = end;
        continue;
      }
    }

    // Link: [label](url)
    if (ch === "[") {
      const closeLabel = takeUntil(text, i + 1, "]");
      if (closeLabel !== -1 && text[closeLabel + 1] === "(") {
        const closeUrl = takeUntil(text, closeLabel + 2, ")");
        if (closeUrl !== -1) {
          const label = text.slice(i + 1, closeLabel);
          const href = text.slice(closeLabel + 2, closeUrl);
          flush();
          out.push({ kind: "link", text: label, href });
          i = closeUrl;
          continue;
        }
      }
    }

    buffer += ch;
  }

  flush();
  return out;
}

function tokenLen(token: MarkdownToken): number {
  switch (token.kind) {
    case "link":
      return token.text.length;
    case "code_block":
      return token.text.length;
    default:
      return token.text.length;
  }
}

function splitTextToken(token: { kind: "text"; text: string }, maxChars: number): MarkdownToken[] {
  const chunks: MarkdownToken[] = [];
  let remaining = token.text;
  const limit = Math.max(1, maxChars);

  while (remaining.length > limit) {
    const window = remaining.slice(0, limit + 1);
    let cut = window.lastIndexOf("\n");
    if (cut < Math.floor(limit * 0.6)) {
      cut = window.lastIndexOf(" ");
    }
    if (cut < 1) cut = limit;
    chunks.push({ kind: "text", text: remaining.slice(0, cut) });
    remaining = remaining.slice(cut);
  }
  if (remaining.length > 0) chunks.push({ kind: "text", text: remaining });
  return chunks;
}

function splitCodeBlockToken(token: { kind: "code_block"; text: string; lang?: string }, maxChars: number): MarkdownToken[] {
  const chunks: MarkdownToken[] = [];
  const limit = Math.max(1, maxChars);
  let remaining = token.text;

  while (remaining.length > limit) {
    const window = remaining.slice(0, limit + 1);
    let cut = window.lastIndexOf("\n");
    if (cut < 1) cut = limit;
    chunks.push({ kind: "code_block", text: remaining.slice(0, cut), lang: token.lang });
    remaining = remaining.slice(cut);
  }
  chunks.push({ kind: "code_block", text: remaining, lang: token.lang });
  return chunks;
}

export interface ChunkIrResult {
  chunks: MarkdownToken[][];
  /** True when styles had to be degraded to plain text due to token size. */
  degraded: boolean;
}

export function chunkMarkdownIr(tokens: MarkdownToken[], maxChars: number): ChunkIrResult {
  const limit = Math.max(1, maxChars);
  const chunks: MarkdownToken[][] = [];
  let current: MarkdownToken[] = [];
  let used = 0;
  let degraded = false;

  const flush = (): void => {
    if (current.length === 0) return;
    chunks.push(current);
    current = [];
    used = 0;
  };

  const pushToken = (t: MarkdownToken): void => {
    const len = tokenLen(t);
    if (len === 0) {
      current.push(t);
      return;
    }
    if (used + len <= limit) {
      current.push(t);
      used += len;
      return;
    }

    if (current.length > 0) {
      flush();
      pushToken(t);
      return;
    }

    // Token itself is larger than maxChars; split if possible, else degrade.
    if (t.kind === "text") {
      for (const part of splitTextToken(t, limit)) {
        pushToken(part);
      }
      return;
    }

    if (t.kind === "code_block") {
      for (const part of splitCodeBlockToken(t, limit)) {
        pushToken(part);
      }
      return;
    }

    degraded = true;
    for (const part of splitTextToken({ kind: "text", text: t.text }, limit)) {
      pushToken(part);
    }
  };

  for (const token of tokens) {
    pushToken(token);
  }
  flush();

  return { chunks: chunks.length > 0 ? chunks : [[]], degraded };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function renderTelegramHtml(tokens: MarkdownToken[]): string {
  let out = "";
  for (const t of tokens) {
    switch (t.kind) {
      case "text":
        out += escapeHtml(t.text);
        break;
      case "bold":
        out += `<b>${escapeHtml(t.text)}</b>`;
        break;
      case "italic":
        out += `<i>${escapeHtml(t.text)}</i>`;
        break;
      case "strike":
        out += `<s>${escapeHtml(t.text)}</s>`;
        break;
      case "code_inline":
        out += `<code>${escapeHtml(t.text)}</code>`;
        break;
      case "code_block":
        out += `<pre><code>${escapeHtml(t.text)}</code></pre>`;
        break;
      case "link": {
        const label = t.text.length > 0 ? t.text : t.href;
        if (isAllowedUrl(t.href)) {
          out += `<a href="${escapeAttr(t.href)}">${escapeHtml(label)}</a>`;
        } else {
          out += `${escapeHtml(label)} (${escapeHtml(t.href)})`;
        }
        break;
      }
    }
  }
  return out;
}

