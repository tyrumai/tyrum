import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface MemorySearchHit {
  source: "core" | "daily";
  file: string;
  snippet: string;
}

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

export class MarkdownMemoryStore {
  readonly memoryDir: string;
  readonly corePath: string;

  constructor(home: string) {
    this.memoryDir = join(home, "memory");
    this.corePath = join(this.memoryDir, "MEMORY.md");
  }

  async ensureInitialized(): Promise<void> {
    await mkdir(this.memoryDir, { recursive: true });
    try {
      await readFile(this.corePath, "utf-8");
    } catch (err) {
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code?: unknown }).code === "ENOENT"
      ) {
        await writeFile(this.corePath, "# MEMORY\n\n## Learned Preferences\n\n", "utf-8");
        return;
      }
      throw new Error(`Failed to read core memory file: ${this.corePath}`, { cause: err });
    }
  }

  dailyPath(date: Date): string {
    return join(this.memoryDir, `${isoDay(date)}.md`);
  }

  async appendDaily(entry: string, date = new Date()): Promise<string> {
    await this.ensureInitialized();
    const path = this.dailyPath(date);
    const timestamp = date.toISOString();
    const block = `\n## ${timestamp}\n${entry.trim()}\n`;
    await appendFile(path, block, "utf-8");
    return path;
  }

  async upsertCoreSection(sectionKey: string, content: string): Promise<void> {
    await this.ensureInitialized();
    const raw = await readFile(this.corePath, "utf-8");
    const normalized = normalizeLines(raw);
    const lines = normalized.split("\n");
    const bounds = findLevel2Section(lines, sectionKey);
    const heading = `## ${sectionKey}`;
    const contentLines = content.trim().length > 0 ? content.trim().split("\n") : [];

    if (!bounds) {
      const base = normalized.trimEnd();
      const prefix = base.length > 0 ? `${base}\n` : "";
      const appended = `${prefix}\n${heading}\n\n${content.trim()}\n`;
      await writeFile(this.corePath, appended, "utf-8");
      return;
    }

    const beforeLines = lines.slice(0, bounds.startLine);
    const afterLines = lines.slice(bounds.endLine);
    const rebuilt =
      [...beforeLines, heading, "", ...contentLines, "", ...afterLines].join("\n").trimEnd() + "\n";

    await writeFile(this.corePath, rebuilt, "utf-8");
  }

  async appendToCoreSection(sectionKey: string, line: string): Promise<void> {
    await this.ensureInitialized();
    const raw = await readFile(this.corePath, "utf-8");
    const normalized = normalizeLines(raw);
    const lines = normalized.split("\n");
    const bounds = findLevel2Section(lines, sectionKey);
    const heading = `## ${sectionKey}`;
    const normalizedLine = line.trim();

    if (!bounds) {
      const base = normalized.trimEnd();
      const prefix = base.length > 0 ? `${base}\n` : "";
      const appended = `${prefix}\n${heading}\n\n${normalizedLine}\n`;
      await writeFile(this.corePath, appended, "utf-8");
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

    const coreRaw = await readFile(this.corePath, "utf-8");
    const coreLines = normalizeLines(coreRaw).split("\n");
    for (const line of coreLines) {
      if (line.toLowerCase().includes(normalizedQuery)) {
        hits.push({
          source: "core",
          file: "MEMORY.md",
          snippet: line.trim(),
        });
        if (hits.length >= limit) return hits;
      }
    }

    const files = await readdir(this.memoryDir, { withFileTypes: true });
    const dailyFiles = files
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
      .toSorted()
      .toReversed();

    for (const name of dailyFiles) {
      if (hits.length >= limit) break;
      const raw = await readFile(join(this.memoryDir, name), "utf-8");
      const lines = normalizeLines(raw).split("\n");
      for (const line of lines) {
        if (!line.toLowerCase().includes(normalizedQuery)) {
          continue;
        }
        hits.push({
          source: "daily",
          file: name,
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
