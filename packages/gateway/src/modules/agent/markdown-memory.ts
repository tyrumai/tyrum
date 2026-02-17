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
    } catch {
      await writeFile(this.corePath, "# MEMORY\n\n## Learned Preferences\n\n", "utf-8");
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
    const heading = `## ${sectionKey}`;
    const raw = await readFile(this.corePath, "utf-8");
    const normalized = normalizeLines(raw);
    const nextSectionRegex = /^##\s+/m;
    const startIndex = normalized.indexOf(heading);

    if (startIndex >= 0) {
      const before = normalized.slice(0, startIndex);
      const afterStart = startIndex + heading.length;
      const tail = normalized.slice(afterStart);
      const nextIndexInTail = tail.search(nextSectionRegex);
      const after =
        nextIndexInTail >= 0 ? tail.slice(nextIndexInTail) : "";
      const rebuilt = `${before}${heading}\n\n${content.trim()}\n\n${after}`.trimEnd() + "\n";
      await writeFile(this.corePath, rebuilt, "utf-8");
      return;
    }

    const suffix = normalized.endsWith("\n") ? "" : "\n";
    const appended = `${normalized}${suffix}\n${heading}\n\n${content.trim()}\n`;
    await writeFile(this.corePath, appended, "utf-8");
  }

  async appendToCoreSection(sectionKey: string, line: string): Promise<void> {
    await this.ensureInitialized();
    const heading = `## ${sectionKey}`;
    const raw = await readFile(this.corePath, "utf-8");
    const normalized = normalizeLines(raw);
    const startIndex = normalized.indexOf(heading);
    const normalizedLine = line.trim();

    if (startIndex < 0) {
      const fallback = normalized.endsWith("\n") ? normalized : `${normalized}\n`;
      const appended = `${fallback}\n${heading}\n\n${normalizedLine}\n`;
      await writeFile(this.corePath, appended, "utf-8");
      return;
    }

    const afterHeadingIndex = startIndex + heading.length;
    const tail = normalized.slice(afterHeadingIndex);
    const nextHeadingOffset = tail.search(/^##\s+/m);
    const sectionBody = (nextHeadingOffset >= 0 ? tail.slice(0, nextHeadingOffset) : tail).trim();

    const lines = sectionBody
      .split("\n")
      .map((existing) => existing.trim())
      .filter((existing) => existing.length > 0);

    if (!lines.includes(normalizedLine)) {
      lines.push(normalizedLine);
    }

    await this.upsertCoreSection(sectionKey, `${lines.join("\n")}\n`);
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
      .sort()
      .reverse();

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
