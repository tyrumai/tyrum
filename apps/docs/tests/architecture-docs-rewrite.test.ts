import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
const architectureTemplate = "docs/architecture/reference/doc-templates.md";
const compactReferencePages = new Set([
  "docs/architecture/gateway/sandbox-policy/sandbox-profiles.md",
  "docs/architecture/gateway/skills.md",
  "docs/architecture/reference/glossary.md",
  "docs/architecture/scaling-ha/data-model-fk-audit.md",
  "docs/architecture/scaling-ha/db-enum-constraints.md",
  "docs/architecture/scaling-ha/db-json-hygiene.md",
  "docs/architecture/scaling-ha/db-naming-conventions.md",
  "docs/architecture/scaling-ha/statestore-dialects.md",
]);
const referenceHeavyPages = [
  "docs/architecture/agent/messages/sessions-lanes.md",
  "docs/architecture/protocol/events.md",
  "docs/architecture/scaling-ha/backplane.md",
  "docs/architecture/scaling-ha/data-lifecycle.md",
  "docs/architecture/scaling-ha/data-model-map.md",
  "docs/architecture/scaling-ha/operational-maintenance.md",
  "docs/architecture/reference/glossary.md",
  "docs/architecture/scaling-ha/data-model-fk-audit.md",
  "docs/architecture/scaling-ha/db-enum-constraints.md",
  "docs/architecture/scaling-ha/db-json-hygiene.md",
  "docs/architecture/scaling-ha/db-naming-conventions.md",
  "docs/architecture/scaling-ha/statestore-dialects.md",
];

async function readRepoFile(path: string): Promise<string> {
  return await readFile(resolve(repoRoot, path), "utf8");
}

async function listRepoMarkdownFiles(path: string): Promise<string[]> {
  const absolutePath = resolve(repoRoot, path);
  const entries = await readdir(absolutePath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = resolve(absolutePath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listRepoMarkdownFiles(relative(repoRoot, entryPath))));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(relative(repoRoot, entryPath).split(sep).join("/"));
    }
  }

  return files.toSorted();
}

function getArchitectureSidebarDocPaths(sidebars: string): string[] {
  const architectureDocIds = Array.from(sidebars.matchAll(/"architecture\/[^"]+"/g), (match) =>
    match[0].slice(1, -1),
  );
  return architectureDocIds.map((id) => `docs/${id}.md`).toSorted();
}

describe("Architecture docs rewrite", () => {
  it("restructures the architecture sidebar into newcomer-first tiers", async () => {
    const sidebars = await readRepoFile("apps/docs/sidebars.ts");

    expect(sidebars).toMatch(/label: "Architecture"/);
    expect(sidebars).toMatch(/label: "Overview"/);
    expect(sidebars).toMatch(/label: "Gateway"/);
    expect(sidebars).toMatch(/label: "Safety & Governance"/);
    expect(sidebars).toMatch(/label: "Extensibility & Operators"/);
    expect(sidebars).toMatch(/label: "Agent"/);
    expect(sidebars).toMatch(/label: "Protocol"/);
    expect(sidebars).toMatch(/label: "Client & Node"/);
    expect(sidebars).toMatch(/label: "Deployment & Data"/);
    expect(sidebars).toMatch(/label: "Mechanics & Reference"/);
    expect(sidebars).toMatch(/label: "Reference"/);
  });

  it("documents the architecture archetypes and Mermaid guidance", async () => {
    const templates = await readRepoFile("docs/architecture/reference/doc-templates.md");

    expect(templates).toMatch(/## Page archetypes/m);
    expect(templates).toMatch(/\bOverview\b/);
    expect(templates).toMatch(/\bComponent\b/);
    expect(templates).toMatch(/\bReference\b/);
    expect(templates).toMatch(/Read this if/i);
    expect(templates).toMatch(/Skip this if/i);
    expect(templates).toMatch(/Go deeper/i);
    expect(templates).toMatch(
      /Level 0 and Level 1 pages must include at least one Mermaid diagram/i,
    );
  });

  it("keeps every architecture doc reachable from the newcomer-first sidebar", async () => {
    const sidebars = await readRepoFile("apps/docs/sidebars.ts");
    const sidebarDocPaths = getArchitectureSidebarDocPaths(sidebars);
    const architectureDocPaths = await listRepoMarkdownFiles("docs/architecture");

    expect(sidebarDocPaths).toEqual(architectureDocPaths);
  });

  it("gives every architecture page an orientation cue", async () => {
    const architectureDocPaths = await listRepoMarkdownFiles("docs/architecture");
    const pagePaths = architectureDocPaths.filter((page) => page !== architectureTemplate);

    for (const page of pagePaths) {
      const content = await readRepoFile(page);
      expect(content, `${page} should include orientation guidance`).toMatch(/Read this if/i);
      expect(content, `${page} should include a skip cue`).toMatch(/Skip this if/i);
      expect(content, `${page} should include a drill-down cue`).toMatch(
        /Go deeper|Drill-down|Related docs/i,
      );
    }
  });

  it("uses Mermaid on all diagram-backed architecture pages", async () => {
    const architectureDocPaths = await listRepoMarkdownFiles("docs/architecture");
    const pagePaths = architectureDocPaths.filter((page) => page !== architectureTemplate);

    for (const page of pagePaths) {
      const content = await readRepoFile(page);

      if (compactReferencePages.has(page)) {
        expect(content, `${page} should stay scan-friendly without a diagram`).toMatch(/\|.+\|/);
        continue;
      }

      expect(content, `${page} should include a Mermaid diagram`).toMatch(/```mermaid/);
    }
  });

  it("marks reference-heavy architecture pages as mechanics or reference docs", async () => {
    for (const page of referenceHeavyPages) {
      const content = await readRepoFile(page);
      expect(content, `${page} should frame itself as mechanics/reference content`).toMatch(
        /reference page|reference card|reference lexicon|reference decision record|mechanics page|mechanics\/reference page|schema reference page|scaling\/reference page/i,
      );
      expect(content, `${page} should include orientation guidance`).toMatch(/Read this if/i);
    }
  });
});
