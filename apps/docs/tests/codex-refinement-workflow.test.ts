import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCodexThreadMap, upsertCodexThreadMap } from "../../../scripts/codex-thread-map.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

async function readRepoFile(path: string): Promise<string> {
  return await readFile(resolve(repoRoot, path), "utf8");
}

describe("Codex refinement workflow", () => {
  it("documents the GitHub issue and Codex thread hierarchy", async () => {
    const doc = await readRepoFile(".github/codex-refinement.md");

    expect(doc).toMatch(/GitHub is the planning source of truth/);
    expect(doc).toMatch(/Each GitHub issue gets one reusable Codex thread/);
    expect(doc).toMatch(/Parent issue threads are coordinator threads/);
    expect(doc).toMatch(/Child issue threads are implementation or focused refinement threads/);
    expect(doc).toMatch(/spawned from the parent thread after the child issue exists/);
    expect(doc).toMatch(/Product Refinement Hub/);
    expect(doc).toMatch(/daily sweep issue/i);
    expect(doc).toMatch(/A finding is not durable work until it passes a promotion gate/);
    expect(doc).toMatch(/Capacity Budget/);
    expect(doc).toMatch(/Definition Of Ready/);
    expect(doc).toMatch(/Outcome Review/);
    expect(doc).toMatch(/Weekly Cross-Team Learning/);
    expect(doc).toMatch(/Stale-Work Cleanup/);
    expect(doc).toMatch(/scripts\/refinement-github\.mjs/);
    expect(doc).toMatch(/setup --apply/);
    expect(doc).toMatch(/create-sweep --apply/);
    expect(doc).toMatch(/\/opt\/homebrew\/bin\/gh/);
    expect(doc).toMatch(/keychain access/i);
  });

  it("provides issue templates with thread map markers", async () => {
    const [hubTemplate, sweepTemplate, parentTemplate, childTemplate] = await Promise.all([
      readRepoFile(".github/ISSUE_TEMPLATE/product-refinement-hub.md"),
      readRepoFile(".github/ISSUE_TEMPLATE/product-refinement-daily-sweep.md"),
      readRepoFile(".github/ISSUE_TEMPLATE/product-refinement-initiative.md"),
      readRepoFile(".github/ISSUE_TEMPLATE/product-refinement-work-item.md"),
    ]);

    expect(parseCodexThreadMap(hubTemplate)).toMatchObject({
      version: "1",
      issue: "pending",
      role: "hub",
      root_issue: "pending",
    });
    expect(hubTemplate).toMatch(/## Capacity Budget/);
    expect(hubTemplate).toMatch(/## Weekly Cross-Team Learning/);
    expect(hubTemplate).toMatch(/## Stale-Work Review/);

    expect(parseCodexThreadMap(sweepTemplate)).toMatchObject({
      version: "1",
      issue: "pending",
      role: "daily-sweep",
    });
    expect(sweepTemplate).toMatch(/## Candidate Findings/);
    expect(sweepTemplate).toMatch(/## Promotion Gate/);
    expect(sweepTemplate).toMatch(/No implementation work starts directly from this sweep/);

    expect(parseCodexThreadMap(parentTemplate)).toMatchObject({
      version: "1",
      issue: "pending",
      role: "parent",
      root_issue: "pending",
    });
    expect(parentTemplate).toMatch(/## Candidate List/);
    expect(parentTemplate).toMatch(/## Promotion Gate/);
    expect(parentTemplate).toMatch(/## Definition Of Ready/);
    expect(parentTemplate).toMatch(/## Codex Thread Protocol/);
    expect(parentTemplate).toMatch(/Spawn child issue threads from this parent thread/);

    expect(parseCodexThreadMap(childTemplate)).toMatchObject({
      version: "1",
      issue: "pending",
      role: "child",
    });
    expect(childTemplate).toMatch(/## Parent Issue/);
    expect(childTemplate).toMatch(/## Definition Of Ready/);
    expect(childTemplate).toMatch(/## Validation/);
    expect(childTemplate).toMatch(/## Definition Of Done/);
    expect(childTemplate).toMatch(/## Outcome Review/);
    expect(childTemplate).toMatch(
      /This child thread should be spawned from the parent issue thread/,
    );
  });

  it("updates a codex-thread-map block without disturbing the issue body", () => {
    const issueBody = [
      "<!-- codex-thread-map",
      "version: 1",
      "issue: pending",
      "role: child",
      "parent_issue: 100",
      "root_issue: 100",
      "codex_thread_id:",
      "codex_thread_url:",
      "spawned_from_thread_id:",
      "last_sync:",
      "-->",
      "",
      "## Objective",
      "",
      "Ship the focused slice.",
    ].join("\n");

    const updated = upsertCodexThreadMap(issueBody, {
      issue: "123",
      codex_thread_id: "thread_abc",
      spawned_from_thread_id: "thread_parent",
    });

    expect(parseCodexThreadMap(updated)).toMatchObject({
      issue: "123",
      role: "child",
      parent_issue: "100",
      codex_thread_id: "thread_abc",
      spawned_from_thread_id: "thread_parent",
    });
    expect(updated).toContain("Ship the focused slice.");
  });
});
