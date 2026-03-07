import type { MemorySearchHit } from "./markdown-memory.js";
import { MarkdownMemoryDal } from "./markdown-memory-dal.js";
import type { AgentMemoryStore } from "./context-store.js";

function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function normalizeLines(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findLevel2Section(
  lines: readonly string[],
  sectionKey: string,
): { startLine: number; endLine: number } | undefined {
  const heading = new RegExp(`^##\\s+${escapeRegExp(sectionKey)}\\s*$`);
  let startLine = -1;

  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx] ?? "";
    if (heading.test(line)) {
      startLine = idx;
      break;
    }
  }

  if (startLine < 0) {
    return undefined;
  }

  let endLine = lines.length;
  for (let idx = startLine + 1; idx < lines.length; idx += 1) {
    const line = lines[idx] ?? "";
    if (/^##\s+/.test(line)) {
      endLine = idx;
      break;
    }
  }

  return { startLine, endLine };
}

export class SharedMarkdownMemoryStore implements AgentMemoryStore {
  constructor(
    private readonly dal: MarkdownMemoryDal,
    private readonly scope: { tenantId: string; agentId: string },
  ) {}

  async ensureInitialized(): Promise<void> {
    await this.dal.ensureCoreDoc(this.scope);
  }

  async appendDaily(entry: string, date = new Date()): Promise<string> {
    await this.ensureInitialized();
    const docKey = isoDay(date);
    const existing = await this.dal.getDoc({
      ...this.scope,
      docKind: "daily",
      docKey,
    });
    const timestamp = date.toISOString();
    const block = `\n## ${timestamp}\n${entry.trim()}\n`;
    const content = `${existing?.content ?? ""}${block}`;
    await this.dal.putDoc({
      ...this.scope,
      docKind: "daily",
      docKey,
      content,
    });
    return `db://markdown-memory/${this.scope.tenantId}/${this.scope.agentId}/daily/${docKey}`;
  }

  async upsertCoreSection(sectionKey: string, content: string): Promise<void> {
    await this.ensureInitialized();
    const core = await this.dal.ensureCoreDoc(this.scope);
    const normalized = normalizeLines(core.content);
    const lines = normalized.split("\n");
    const bounds = findLevel2Section(lines, sectionKey);
    const heading = `## ${sectionKey}`;
    const contentLines = content.trim().length > 0 ? content.trim().split("\n") : [];

    if (!bounds) {
      const base = normalized.trimEnd();
      const prefix = base.length > 0 ? `${base}\n` : "";
      await this.dal.putDoc({
        ...this.scope,
        docKind: "core",
        docKey: "MEMORY",
        content: `${prefix}\n${heading}\n\n${content.trim()}\n`,
      });
      return;
    }

    const beforeLines = lines.slice(0, bounds.startLine);
    const afterLines = lines.slice(bounds.endLine);
    await this.dal.putDoc({
      ...this.scope,
      docKind: "core",
      docKey: "MEMORY",
      content:
        [...beforeLines, heading, "", ...contentLines, "", ...afterLines].join("\n").trimEnd() +
        "\n",
    });
  }

  async appendToCoreSection(sectionKey: string, line: string): Promise<void> {
    await this.ensureInitialized();
    const core = await this.dal.ensureCoreDoc(this.scope);
    const lines = normalizeLines(core.content).split("\n");
    const bounds = findLevel2Section(lines, sectionKey);
    const heading = `## ${sectionKey}`;
    const normalizedLine = line.trim();

    if (!bounds) {
      const base = core.content.trimEnd();
      const prefix = base.length > 0 ? `${base}\n` : "";
      await this.dal.putDoc({
        ...this.scope,
        docKind: "core",
        docKey: "MEMORY",
        content: `${prefix}\n${heading}\n\n${normalizedLine}\n`,
      });
      return;
    }

    const bodyLines = lines
      .slice(bounds.startLine + 1, bounds.endLine)
      .map((existing) => existing.trim())
      .filter((existing) => existing.length > 0);

    if (!bodyLines.includes(normalizedLine)) {
      bodyLines.push(normalizedLine);
    }

    await this.upsertCoreSection(sectionKey, bodyLines.join("\n"));
  }

  async search(query: string, limit: number): Promise<MemorySearchHit[]> {
    await this.ensureInitialized();

    const normalizedQuery = query.trim().toLowerCase();
    if (normalizedQuery.length === 0 || limit <= 0) {
      return [];
    }

    const hits: MemorySearchHit[] = [];
    const docs = await this.dal.listDocs({ ...this.scope, limit: 512 });
    const sortedDocs = docs.toSorted((left, right) => {
      if (left.docKind !== right.docKind) {
        return left.docKind === "core" ? -1 : 1;
      }
      return right.docKey.localeCompare(left.docKey);
    });

    for (const doc of sortedDocs) {
      const lines = normalizeLines(doc.content).split("\n");
      for (const line of lines) {
        if (!line.toLowerCase().includes(normalizedQuery)) continue;
        hits.push({
          source: doc.docKind,
          file: doc.docKind === "core" ? "MEMORY.md" : `${doc.docKey}.md`,
          snippet: line.trim(),
        });
        if (hits.length >= limit) {
          return hits;
        }
      }
    }

    return hits;
  }
}
