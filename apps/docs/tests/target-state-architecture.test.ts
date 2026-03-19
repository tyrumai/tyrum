import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
const targetStateDocPath = "docs/architecture/target-state.md";
const targetStateDecisionPath = "docs/architecture/reference/arch-01-clean-break-target-state.md";
const prTemplatePath = ".github/pull_request_template.md";
const contributorEntryPoints = [
  "README.md",
  "CONTRIBUTING.md",
  "AGENTS.md",
  "docs/architecture/index.md",
] as const;
const targetStatePackages = [
  "@tyrum/contracts",
  "@tyrum/transport-sdk",
  "@tyrum/node-sdk",
  "@tyrum/operator-app",
  "@tyrum/operator-ui",
  "@tyrum/runtime-policy",
  "@tyrum/runtime-node-control",
  "@tyrum/runtime-execution",
  "@tyrum/runtime-agent",
  "@tyrum/runtime-workboard",
  "@tyrum/gateway",
] as const;

async function readRepoFile(path: string): Promise<string> {
  return await readFile(resolve(repoRoot, path), "utf8");
}

describe("Target-state architecture docs", () => {
  it("points contributor entry points at the target-state architecture page", async () => {
    for (const entryPoint of contributorEntryPoints) {
      const content = await readRepoFile(entryPoint);
      expect(content, `${entryPoint} should mention the target-state architecture page`).toMatch(
        /target-state/i,
      );
      expect(content, `${entryPoint} should link to the target-state architecture page`).toMatch(
        /docs\/architecture\/target-state\.md|\/architecture\/target-state/,
      );
    }
  });

  it("defines the clean-break target package graph and migration rules", async () => {
    const targetState = await readRepoFile(targetStateDocPath);

    expect(targetState).toMatch(/Read this if/i);
    expect(targetState).toMatch(/Skip this if/i);
    expect(targetState).toMatch(/Go deeper/i);
    expect(targetState).toMatch(/```mermaid/);
    expect(targetState).toMatch(/allowed dependency directions/i);
    expect(targetState).toMatch(/clean-break rule/i);
    expect(targetState).toMatch(/no backwards-compatibility shims/i);
    expect(targetState).toMatch(/temporary coexistence/i);
    expect(targetState).toMatch(/composition root/i);

    for (const packageName of targetStatePackages) {
      expect(targetState, `${targetStateDocPath} should mention ${packageName}`).toContain(
        packageName,
      );
    }
  });

  it("links the target-state architecture page to a long-lived decision record", async () => {
    const [targetState, decisionRecord] = await Promise.all([
      readRepoFile(targetStateDocPath),
      readRepoFile(targetStateDecisionPath),
    ]);

    expect(targetState).toMatch(/reference\/arch-01-clean-break-target-state\.md/);
    expect(decisionRecord).toMatch(/reference decision record/i);
    expect(decisionRecord).toMatch(/clean-break/i);
    expect(decisionRecord).toMatch(/target package graph/i);
  });

  it("adds a PR template architecture checklist for the migration", async () => {
    const prTemplate = await readRepoFile(prTemplatePath);

    expect(prTemplate).toMatch(/Closes #<issue>/);
    expect(prTemplate).toMatch(/target package\/layer/i);
    expect(prTemplate).toMatch(/legacy package/i);
    expect(prTemplate).toMatch(/@tyrum\/schemas/);
    expect(prTemplate).toMatch(/@tyrum\/client/);
    expect(prTemplate).toMatch(/@tyrum\/operator-core/);
    expect(prTemplate).toMatch(/target-state architecture/i);
  });
});
