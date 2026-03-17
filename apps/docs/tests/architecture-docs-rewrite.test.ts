import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

async function readRepoFile(path: string): Promise<string> {
  return await readFile(resolve(repoRoot, path), "utf8");
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

  it("gives every overview page an orientation cue and Mermaid diagram", async () => {
    const overviewPages = [
      "docs/architecture/index.md",
      "docs/architecture/gateway/index.md",
      "docs/architecture/agent/index.md",
      "docs/architecture/protocol/index.md",
      "docs/architecture/client/index.md",
      "docs/architecture/node/index.md",
      "docs/architecture/scaling-ha/index.md",
    ];

    for (const page of overviewPages) {
      const content = await readRepoFile(page);
      expect(content, `${page} should include an orientation cue`).toMatch(/Read this if/i);
      expect(content, `${page} should include a drill-down cue`).toMatch(/Go deeper|Drill-down/i);
      expect(content, `${page} should include a Mermaid diagram`).toMatch(/```mermaid/);
    }
  });

  it("marks reference-heavy pages as mechanics docs with quick orientation", async () => {
    const referencePages = [
      "docs/architecture/protocol/events.md",
      "docs/architecture/agent/messages/sessions-lanes.md",
      "docs/architecture/scaling-ha/data-lifecycle.md",
      "docs/architecture/scaling-ha/data-model-map.md",
    ];

    for (const page of referencePages) {
      const content = await readRepoFile(page);
      expect(content, `${page} should frame itself as a reference page`).toMatch(
        /reference page|schema reference page|mechanics\/reference page|scaling\/reference page/i,
      );
      expect(content, `${page} should include orientation guidance`).toMatch(/Read this if/i);
      expect(content, `${page} should include a Mermaid diagram`).toMatch(/```mermaid/);
    }
  });
});
