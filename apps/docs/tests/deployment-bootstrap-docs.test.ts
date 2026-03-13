import { describe, expect, it } from "vitest";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listMarkdownFiles } from "./markdown-utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
const docsRoot = resolve(repoRoot, "docs");

function extractMarkdownLinks(markdown: string): string[] {
  const matches = markdown.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g);
  return Array.from(matches, (match) => match[1] ?? "");
}

function isLocalMarkdownLink(target: string): boolean {
  if (!target || target.startsWith("#")) return false;
  if (/^(https?:|mailto:|tel:|data:)/i.test(target)) return false;
  return true;
}

async function readRepoFile(path: string): Promise<string> {
  return await readFile(resolve(repoRoot, path), "utf8");
}

describe("deployment bootstrap docs", () => {
  it("removes stale env-driven gateway startup guidance from core docs", async () => {
    const install = await readRepoFile("docs/install.md");
    const gettingStarted = await readRepoFile("docs/getting-started.md");
    const remote = await readRepoFile("docs/advanced/remote-gateway.md");
    const multiNode = await readRepoFile("docs/advanced/multi-node.md");
    const profiles = await readRepoFile("docs/advanced/deployment-profiles.md");

    expect(install).not.toContain("TYRUM_AGENT_ENABLED");
    expect(gettingStarted).not.toContain("TYRUM_AGENT_ENABLED");
    expect(gettingStarted).not.toContain("GATEWAY_PORT=8789");
    expect(remote).not.toContain("GATEWAY_HOST=0.0.0.0");
    expect(remote).not.toContain("TYRUM_TLS_READY");
    expect(remote).not.toContain("TYRUM_TLS_SELF_SIGNED");
    expect(remote).not.toContain("TYRUM_ALLOW_INSECURE_HTTP");
    expect(multiNode).not.toContain("TYRUM_HOME=");
    expect(multiNode).not.toContain("GATEWAY_PORT=");
    expect(profiles).not.toContain("env.GATEWAY_DB_PATH");
  });

  it("documents the deployment-config admin surface and valid canonical links", async () => {
    const apiReference = await readRepoFile("docs/api-reference.md");

    expect(apiReference).toContain("/system/deployment-config");
  });

  it("keeps local markdown links valid across source docs", async () => {
    const markdownFiles = [
      resolve(repoRoot, "README.md"),
      resolve(repoRoot, "AGENTS.md"),
      resolve(repoRoot, "apps/desktop/README.md"),
      ...(await listMarkdownFiles(docsRoot)),
    ];

    for (const file of markdownFiles) {
      const content = await readFile(file, "utf8");
      const links = extractMarkdownLinks(content).filter(isLocalMarkdownLink);

      for (const link of links) {
        const linkPath = link.split("#", 1)[0]?.split("?", 1)[0] ?? "";
        if (linkPath.length === 0) continue;

        const targetPath = resolve(dirname(file), linkPath);
        const info = await stat(targetPath);
        expect(
          info.isFile() || info.isDirectory(),
          `broken local markdown link in ${file}: ${link}`,
        ).toBe(true);
      }
    }
  });
});
