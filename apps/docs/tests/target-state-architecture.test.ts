import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
const targetStateDocPath = "docs/architecture/target-state.md";
const targetStateDecisionPath = "docs/architecture/reference/arch-01-clean-break-target-state.md";
const dedicatedNodeToolsDecisionPath =
  "docs/architecture/reference/arch-19-dedicated-node-backed-tools.md";
const gatewayDocPath = "docs/architecture/gateway/index.md";
const toolsDocPath = "docs/architecture/gateway/tools.md";
const secretsDocPath = "docs/architecture/gateway/secrets.md";
const sidebarsPath = "apps/docs/sidebars.ts";
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

  it("defines the clean-break target package graph as the live architecture", async () => {
    const targetState = await readRepoFile(targetStateDocPath);

    expect(targetState).toMatch(/Read this if/i);
    expect(targetState).toMatch(/Skip this if/i);
    expect(targetState).toMatch(/Go deeper/i);
    expect(targetState).toMatch(/```mermaid/);
    expect(targetState).toMatch(/allowed dependency directions/i);
    expect(targetState).toMatch(/clean-break rule/i);
    expect(targetState).toMatch(/no backwards-compatibility shims/i);
    expect(targetState).toMatch(/composition root/i);
    expect(targetState).not.toMatch(/temporary coexistence/i);
    expect(targetState).not.toContain("@tyrum/client");
    expect(targetState).not.toContain("@tyrum/operator-core");

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

  it("publishes the dedicated node-backed tool decision as a linked architecture reference", async () => {
    const [sidebars, toolsDoc, secretsDoc, decisionRecord] = await Promise.all([
      readRepoFile(sidebarsPath),
      readRepoFile(toolsDocPath),
      readRepoFile(secretsDocPath),
      readRepoFile(dedicatedNodeToolsDecisionPath),
    ]);

    expect(sidebars).toMatch(/architecture\/reference\/arch-19-dedicated-node-backed-tools/);
    expect(toolsDoc).toMatch(/arch-19-dedicated-node-backed-tools/);
    expect(secretsDoc).toMatch(/arch-19-dedicated-node-backed-tools/);
    expect(decisionRecord).toMatch(/reference decision record/i);
    expect(decisionRecord).toMatch(/#1586/);
    expect(decisionRecord).toMatch(/#1585/);
    expect(decisionRecord).toMatch(/tool\.desktop\.screenshot/);
    expect(decisionRecord).toMatch(/tool\.browser\.navigate/);
    expect(decisionRecord).toMatch(/tool\.location\.get/);
    expect(decisionRecord).toMatch(/tool\.secret\.copy-to-node-clipboard/);
    expect(decisionRecord).toMatch(/tool\.node\.list/);
    expect(decisionRecord).toMatch(/tool\.node\.inspect/);
    expect(decisionRecord).toMatch(/tool\.node\.dispatch/);
    expect(decisionRecord).toMatch(/removed from the supported model-facing surface/i);
    expect(decisionRecord).toMatch(/exactly one eligible node/i);
    expect(decisionRecord).toMatch(/ambiguous/i);
    expect(decisionRecord).toMatch(/secret_ref_id/);
    expect(decisionRecord).toMatch(/secret_alias/);
    expect(decisionRecord).toMatch(/allowlist/i);
    expect(decisionRecord).toMatch(/clipboard/i);
  });

  it("describes the gateway page as the public runtime entrypoint composition root", async () => {
    const gatewayDoc = await readRepoFile(gatewayDocPath);

    expect(gatewayDoc).toMatch(/public runtime entrypoint/i);
    expect(gatewayDoc).toMatch(/composition root/i);
    expect(gatewayDoc).toMatch(/transport adapters/i);
    expect(gatewayDoc).toMatch(/bundled operator/i);
  });

  it("adds a PR template architecture checklist for the live target-state graph", async () => {
    const prTemplate = await readRepoFile(prTemplatePath);

    expect(prTemplate).toMatch(/Closes #<issue>/);
    expect(prTemplate).toMatch(/target package\/layer/i);
    expect(prTemplate).toMatch(/@tyrum\/contracts/);
    expect(prTemplate).not.toMatch(/@tyrum\/schemas/);
    expect(prTemplate).not.toMatch(/@tyrum\/client/);
    expect(prTemplate).not.toMatch(/@tyrum\/operator-core/);
    expect(prTemplate).not.toMatch(/temporary coexistence/i);
    expect(prTemplate).toMatch(/target-state architecture/i);
  });
});
