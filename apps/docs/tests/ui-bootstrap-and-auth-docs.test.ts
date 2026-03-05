import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listMarkdownFiles } from "./markdown-utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

describe("UI bootstrap and auth docs (Issue #568)", () => {
  it("updates install + getting started docs for /ui and /auth/session cookie bootstrap", async () => {
    const installDoc = await readFile(resolve(repoRoot, "docs/install.md"), "utf8");
    expect(installDoc).toMatch(/\/ui\b/);
    expect(installDoc).toMatch(/\/auth\/session\b/);
    expect(installDoc).not.toMatch(/\/app\b/);

    const gettingStartedDoc = await readFile(resolve(repoRoot, "docs/getting-started.md"), "utf8");
    expect(gettingStartedDoc).toMatch(/\/ui\b/);
    expect(gettingStartedDoc).not.toMatch(/\/app\b/);
    expect(gettingStartedDoc).not.toMatch(/\btyrum-gateway\b/);

    const readme = await readFile(resolve(repoRoot, "README.md"), "utf8");
    expect(readme).toMatch(/\/ui\b/);
    expect(readme).not.toMatch(/\/app\b/);
  });

  it("removes legacy WS connect handshake from docs", async () => {
    const handshakeDoc = await readFile(
      resolve(repoRoot, "docs/architecture/protocol/handshake.md"),
      "utf8",
    );
    expect(handshakeDoc).not.toMatch(/^## Legacy handshake/m);
    expect(handshakeDoc).not.toMatch(/legacy request\/response handshake/i);
    expect(handshakeDoc).not.toMatch(/gateway rejects legacy `connect` handshake/i);

    const requestsDoc = await readFile(
      resolve(repoRoot, "docs/architecture/protocol/requests-responses.md"),
      "utf8",
    );
    expect(requestsDoc).not.toMatch(/`connect`\s+—\s+legacy handshake/i);
  });

  it("does not document query-token auth in URLs", async () => {
    const docsDir = resolve(repoRoot, "docs");
    const mdFiles = await listMarkdownFiles(docsDir);

    const urlTokenPattern = /[?&](?:access_)?token=/i;
    for (const file of mdFiles) {
      const content = await readFile(file, "utf8");
      expect(content).not.toMatch(urlTokenPattern);
    }

    const readme = await readFile(resolve(repoRoot, "README.md"), "utf8");
    expect(readme).not.toMatch(urlTokenPattern);
  });
});
