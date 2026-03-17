import { describe, expect, it } from "vitest";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

describe("Docs search config", () => {
  it("uses local search instead of Algolia", async () => {
    const [config, searchMetadata] = await Promise.all([
      readFile(resolve(repoRoot, "apps/docs/docusaurus.config.ts"), "utf8"),
      readFile(resolve(repoRoot, "apps/docs/src/theme/SearchMetadata/index.tsx"), "utf8"),
    ]);

    expect(config).toContain('"@easyops-cn/docusaurus-search-local"');
    expect(config).toContain('docsRouteBasePath: "/"');
    expect(config).toContain('docsDir: "../../docs"');
    expect(config).toContain('searchBarPosition: "right"');
    expect(config).toContain("ignoreFiles: [/^\\/_README$/]");
    expect(config).not.toContain("ALGOLIA_APP_ID");
    expect(config).not.toContain("ALGOLIA_SEARCH_API_KEY");
    expect(config).not.toContain("ALGOLIA_INDEX_NAME");
    expect(config).not.toContain('{ type: "search", position: "right" }');
    expect(searchMetadata).toContain('name="docusaurus_locale"');
    expect(searchMetadata).not.toContain("docsearch:");
  });

  it("removes deleted docs from navigation and landing pages", async () => {
    const [sidebars, indexDoc, readme] = await Promise.all([
      readFile(resolve(repoRoot, "apps/docs/sidebars.ts"), "utf8"),
      readFile(resolve(repoRoot, "docs/index.md"), "utf8"),
      readFile(resolve(repoRoot, "docs/_README.md"), "utf8"),
    ]);

    expect(sidebars).not.toContain("executors/http_executor");
    expect(sidebars).not.toContain("executors/web_executor");
    expect(indexDoc).toMatch(/^## Reference$/m);
    expect(indexDoc).not.toContain("./executors/");
    expect(readme).toMatch(/^## Reference$/m);
    expect(readme).not.toContain("executors/");
  });

  it("removes docs/plans and docs/executors from the repo", async () => {
    await expect(access(resolve(repoRoot, "docs/plans"), constants.F_OK)).rejects.toThrow();
    await expect(access(resolve(repoRoot, "docs/executors"), constants.F_OK)).rejects.toThrow();
  });
});
