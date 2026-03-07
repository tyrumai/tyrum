import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContainer } from "../../src/container.js";
import { AgentIdentityDal } from "../../src/modules/agent/identity-dal.js";
import { MarkdownMemoryDal } from "../../src/modules/agent/markdown-memory-dal.js";
import { RuntimePackageDal } from "../../src/modules/agent/runtime-package-dal.js";
import { LifecycleHookConfigDal } from "../../src/modules/hooks/config-dal.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { PolicyBundleConfigDal } from "../../src/modules/policy/config-dal.js";
import { createPluginCatalogProvider } from "../../src/modules/plugins/catalog-provider.js";
import { importLocalHomeToSharedState } from "../../src/modules/runtime-state/import-local-home.js";
import { DEFAULT_CORE_MEMORY_MD, DEFAULT_IDENTITY_MD } from "../../src/modules/agent/home.js";
import { SQLITE_MIGRATIONS_DIR } from "../helpers/sqlite-db.js";
import { pluginEntryModule } from "./plugin-registry.fixtures.test-support.js";

describe("importLocalHomeToSharedState", () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    while (cleanupPaths.length > 0) {
      const path = cleanupPaths.pop();
      if (path) {
        await rm(path, { recursive: true, force: true });
      }
    }
  });

  it("imports local home filesystem state into shared stores", async () => {
    const sourceHome = await mkdtemp(join(tmpdir(), "tyrum-import-source-"));
    const targetHome = await mkdtemp(join(tmpdir(), "tyrum-import-target-"));
    cleanupPaths.push(sourceHome, targetHome);

    await seedSourceHome(sourceHome);

    const container = createContainer(
      {
        dbPath: ":memory:",
        migrationsDir: SQLITE_MIGRATIONS_DIR,
        tyrumHome: targetHome,
      },
      {
        deploymentConfig: {
          state: { mode: "shared" },
        },
      },
    );

    try {
      const summary = await importLocalHomeToSharedState({
        sourceHome,
        tenantId: DEFAULT_TENANT_ID,
        identityScopeDal: container.identityScopeDal,
        artifactStore: container.artifactStore,
        db: container.db,
        createdBy: { kind: "test" },
        reason: "seed",
      });

      expect(summary).toMatchObject({
        tenantId: DEFAULT_TENANT_ID,
        agents: 2,
        identities: 2,
        skills: 1,
        mcpServers: 1,
        plugins: 1,
        hooks: 1,
        deploymentPolicyImported: true,
        agentPolicies: 1,
        markdownDocs: 4,
      });

      const defaultAgentId = await container.identityScopeDal.ensureAgentId(
        DEFAULT_TENANT_ID,
        "default",
      );
      const helperAgentId = await container.identityScopeDal.ensureAgentId(
        DEFAULT_TENANT_ID,
        "helper",
      );

      const identityDal = new AgentIdentityDal(container.db);
      expect(
        (await identityDal.getLatest({ tenantId: DEFAULT_TENANT_ID, agentId: defaultAgentId }))
          ?.identity.body,
      ).toContain("You are Tyrum.");
      expect(
        (await identityDal.getLatest({ tenantId: DEFAULT_TENANT_ID, agentId: helperAgentId }))
          ?.identity.body,
      ).toContain("Helper agent.");

      const runtimePackageDal = new RuntimePackageDal(container.db);
      expect(
        (
          await runtimePackageDal.listLatest({ tenantId: DEFAULT_TENANT_ID, packageKind: "skill" })
        ).map((pkg) => pkg.packageKey),
      ).toEqual(["db-skill"]);
      expect(
        (
          await runtimePackageDal.listLatest({ tenantId: DEFAULT_TENANT_ID, packageKind: "mcp" })
        ).map((pkg) => pkg.packageKey),
      ).toEqual(["calendar"]);
      expect(
        (
          await runtimePackageDal.listLatest({ tenantId: DEFAULT_TENANT_ID, packageKind: "plugin" })
        ).map((pkg) => pkg.packageKey),
      ).toEqual(["echo"]);

      const hooksDal = new LifecycleHookConfigDal(container.db);
      expect((await hooksDal.getLatest(DEFAULT_TENANT_ID))?.hooks).toHaveLength(1);

      const policyBundleDal = new PolicyBundleConfigDal(container.db);
      expect(
        (await policyBundleDal.getLatest({ tenantId: DEFAULT_TENANT_ID, scopeKind: "deployment" }))
          ?.bundle.tools?.allow,
      ).toEqual(["tool.exec"]);
      expect(
        (
          await policyBundleDal.getLatest({
            tenantId: DEFAULT_TENANT_ID,
            scopeKind: "agent",
            agentId: helperAgentId,
          })
        )?.bundle.tools?.require_approval,
      ).toEqual(["tool.exec"]);

      const markdownMemoryDal = new MarkdownMemoryDal(container.db);
      expect(
        (await markdownMemoryDal.listDocs({ tenantId: DEFAULT_TENANT_ID, agentId: defaultAgentId }))
          .length,
      ).toBe(2);
      expect(
        (await markdownMemoryDal.listDocs({ tenantId: DEFAULT_TENANT_ID, agentId: helperAgentId }))
          .length,
      ).toBe(2);

      const pluginCatalogProvider = createPluginCatalogProvider({
        home: targetHome,
        userHome: targetHome,
        logger: container.logger,
        container,
      });
      const plugins = await pluginCatalogProvider.loadTenantRegistry(DEFAULT_TENANT_ID);
      const toolResult = await plugins.executeTool({
        toolId: "plugin.echo.echo",
        toolCallId: "call-1",
        args: { text: "hello" },
        home: "",
        agentId: defaultAgentId,
        workspaceId: "default",
      });
      expect(toolResult?.output).toBe("hello");
    } finally {
      await container.db.close();
    }
  });
});

async function seedSourceHome(sourceHome: string): Promise<void> {
  await writeFile(join(sourceHome, "IDENTITY.md"), DEFAULT_IDENTITY_MD, "utf-8");
  await writeFile(
    join(sourceHome, "hooks.yml"),
    [
      "v: 1",
      "hooks:",
      "  - hook_key: hook:11111111-1111-4111-8111-111111111111",
      "    event: gateway.start",
      "    lane: cron",
      "    steps:",
      "      - type: CLI",
      "        args:",
      "          cmd: echo",
      '          args: ["imported"]',
      "",
    ].join("\n"),
    "utf-8",
  );
  await writeFile(
    join(sourceHome, "policy.yml"),
    [
      "v: 1",
      "tools:",
      "  default: deny",
      '  allow: ["tool.exec"]',
      "  require_approval: []",
      "  deny: []",
      "",
    ].join("\n"),
    "utf-8",
  );

  await mkdir(join(sourceHome, "skills", "db-skill"), { recursive: true });
  await writeFile(
    join(sourceHome, "skills", "db-skill", "SKILL.md"),
    [
      "---",
      "id: db-skill",
      "name: DB Skill",
      "version: 1.0.0",
      "---",
      "Use the database skill.",
    ].join("\n"),
    "utf-8",
  );

  await mkdir(join(sourceHome, "mcp", "calendar"), { recursive: true });
  await writeFile(
    join(sourceHome, "mcp", "calendar", "server.yml"),
    [
      "id: calendar",
      "name: Calendar",
      "enabled: true",
      "transport: stdio",
      "command: node",
      "args: []",
      "",
    ].join("\n"),
    "utf-8",
  );

  await mkdir(join(sourceHome, "memory"), { recursive: true });
  await writeFile(join(sourceHome, "memory", "MEMORY.md"), DEFAULT_CORE_MEMORY_MD, "utf-8");
  await writeFile(
    join(sourceHome, "memory", "2026-03-07.md"),
    "## 2026-03-07T00:00:00.000Z\nImported root\n",
    "utf-8",
  );

  await mkdir(join(sourceHome, "plugins", "echo"), { recursive: true });
  await writeFile(
    join(sourceHome, "plugins", "echo", "plugin.yml"),
    [
      "id: echo",
      "name: Echo",
      "version: 0.0.1",
      "entry: index.mjs",
      "contributes:",
      '  tools: ["plugin.echo.echo"]',
      '  commands: ["echo"]',
      "  routes: []",
      "  mcp_servers: []",
      "permissions:",
      "  tools: []",
      "  network_egress: []",
      "  secrets: []",
      "  db: false",
      "config_schema:",
      "  type: object",
      "  properties: {}",
      "  required: []",
      "  additionalProperties: false",
      "",
    ].join("\n"),
    "utf-8",
  );
  await writeFile(join(sourceHome, "plugins", "echo", "index.mjs"), pluginEntryModule(), "utf-8");

  const helperHome = join(sourceHome, "agents", "helper");
  await mkdir(join(helperHome, "memory"), { recursive: true });
  await writeFile(
    join(helperHome, "IDENTITY.md"),
    ["---", "name: Helper", "---", "Helper agent."].join("\n"),
    "utf-8",
  );
  await writeFile(
    join(helperHome, "policy.yml"),
    [
      "v: 1",
      "tools:",
      "  default: deny",
      "  allow: []",
      '  require_approval: ["tool.exec"]',
      "  deny: []",
      "",
    ].join("\n"),
    "utf-8",
  );
  await writeFile(
    join(helperHome, "memory", "MEMORY.md"),
    "# MEMORY\n\n## Learned Preferences\n\nHelper core\n",
    "utf-8",
  );
  await writeFile(
    join(helperHome, "memory", "2026-03-07.md"),
    "## 2026-03-07T00:00:00.000Z\nImported helper\n",
    "utf-8",
  );
}
