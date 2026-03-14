import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import type { AuthTokenClaims } from "@tyrum/schemas";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { createExtensionsRoutes } from "../../src/routes/extensions.js";

const migrationsDir = join(import.meta.dirname, "../../migrations/sqlite");

function createApp(
  container: GatewayContainer,
  tenantId: string,
  claims?: AuthTokenClaims | Record<string, unknown>,
): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set(
      "authClaims",
      claims ?? {
        token_kind: "tenant",
        token_id: "tenant-token-1",
        tenant_id: tenantId,
        role: "admin",
        scopes: ["*"],
      },
    );
    await next();
  });
  app.route(
    "/",
    createExtensionsRoutes({
      db: container.db,
      container,
    }),
  );
  return app;
}

describe("extensions routes", () => {
  let homeDir: string;
  let container: GatewayContainer;
  let tenantId: string;
  let app: Hono;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-extensions-routes-"));
    container = createContainer(
      { dbPath: ":memory:", migrationsDir, tyrumHome: homeDir },
      { deploymentConfig: { state: { mode: "local" } } },
    );
    tenantId = await container.identityScopeDal.ensureTenantId("extensions-tenant");
    app = createApp(container, tenantId);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await container.db.close();
    await rm(homeDir, { recursive: true, force: true });
  });

  it("imports a skill from direct-url, materializes it, and lists it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            `---
name: Skill From URL
description: Downloaded skill
---
Read the referenced file before changing it.
`,
            {
              status: 200,
              headers: { "content-type": "text/markdown" },
            },
          ),
      ),
    );

    const importResponse = await app.request("/config/extensions/skill/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "direct-url",
        url: "https://example.com/skill/SKILL.md",
      }),
    });
    expect(importResponse.status).toBe(200);
    const imported = (await importResponse.json()) as {
      item: { key: string; materialized_path: string | null };
    };
    expect(imported.item.key).toBe("skill-from-url");
    expect(imported.item.materialized_path).toContain("/managed/skills/skill-from-url/SKILL.md");

    const materialized = await readFile(imported.item.materialized_path!, "utf-8");
    expect(materialized).toContain("Skill From URL");

    const listResponse = await app.request("/config/extensions/skill");
    expect(listResponse.status).toBe(200);
    const listed = (await listResponse.json()) as {
      items: Array<{
        key: string;
        refreshable: boolean;
        assignment_count: number;
        source_type: string;
      }>;
    };
    expect(listed.items).toContainEqual(
      expect.objectContaining({
        key: "skill-from-url",
        refreshable: true,
        assignment_count: 0,
        source_type: "managed",
      }),
    );
  });

  it("rejects direct-url skill imports that target localhost or private addresses", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const response = await app.request("/config/extensions/skill/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "direct-url",
        url: "http://127.0.0.1:8080/skill.zip",
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_request",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("imports, toggles, refreshes, and reverts an npm-backed MCP server", async () => {
    const importResponse = await app.request("/config/extensions/mcp/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "npm",
        npm_spec: "@modelcontextprotocol/server-filesystem",
      }),
    });
    expect(importResponse.status).toBe(200);
    const imported = (await importResponse.json()) as { item: { key: string } };
    const key = imported.item.key;

    const disableResponse = await app.request(`/config/extensions/mcp/${key}/toggle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(disableResponse.status).toBe(200);

    const refreshResponse = await app.request(`/config/extensions/mcp/${key}/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(refreshResponse.status).toBe(200);

    const revertResponse = await app.request(`/config/extensions/mcp/${key}/revert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: 1 }),
    });
    expect(revertResponse.status).toBe(200);

    const detailResponse = await app.request(`/config/extensions/mcp/${key}`);
    expect(detailResponse.status).toBe(200);
    const detail = (await detailResponse.json()) as {
      item: {
        enabled: boolean;
        refreshable: boolean;
        revisions: Array<{ revision: number }>;
        materialized_path: string | null;
      };
    };
    expect(detail.item.enabled).toBe(true);
    expect(detail.item.refreshable).toBe(true);
    expect(detail.item.revisions.map((revision) => revision.revision)).toEqual([4, 3, 2, 1]);
    expect(detail.item.materialized_path).toContain(`/managed/mcp/${key}/server.yml`);
  });

  it("uploads an MCP spec via base64 JSON and materializes the server file", async () => {
    const uploadResponse = await app.request("/config/extensions/mcp/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "server.yml",
        content_type: "application/yaml",
        content_base64: Buffer.from(
          `id: calendar
name: Calendar MCP
enabled: true
transport: remote
url: https://example.com/mcp
`,
          "utf-8",
        ).toString("base64"),
      }),
    });
    expect(uploadResponse.status).toBe(200);
    const payload = (await uploadResponse.json()) as {
      item: { key: string; materialized_path: string | null };
    };
    expect(payload.item.key).toBe("calendar");
    const serverFile = await readFile(payload.item.materialized_path!, "utf-8");
    expect(serverFile).toContain("Calendar MCP");
    expect(serverFile).toContain("https://example.com/mcp");
  });

  it("lists built-in memory and updates shared defaults with YAML settings", async () => {
    const listResponse = await app.request("/config/extensions/mcp");
    expect(listResponse.status).toBe(200);
    const listed = (await listResponse.json()) as {
      items: Array<{ key: string; source_type: string; can_edit_settings: boolean }>;
    };
    expect(listed.items).toContainEqual(
      expect.objectContaining({
        key: "memory",
        source_type: "builtin",
        can_edit_settings: true,
      }),
    );

    const firstUpdateResponse = await app.request("/config/extensions/mcp/memory/defaults", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        default_access: "allow",
        settings_format: "yaml",
        settings_text: `semantic:
  enabled: false
  limit: 9
`,
      }),
    });
    expect(firstUpdateResponse.status).toBe(200);
    await expect(firstUpdateResponse.json()).resolves.toMatchObject({
      item: {
        key: "memory",
        default_access: "allow",
        default_mcp_server_settings_json: {
          semantic: {
            enabled: false,
            limit: 9,
          },
        },
      },
    });

    const secondUpdateResponse = await app.request("/config/extensions/mcp/memory/defaults", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        default_access: "deny",
      }),
    });
    expect(secondUpdateResponse.status).toBe(200);
    await expect(secondUpdateResponse.json()).resolves.toMatchObject({
      item: {
        key: "memory",
        default_access: "deny",
        default_mcp_server_settings_json: {
          semantic: {
            enabled: false,
            limit: 9,
          },
        },
      },
    });

    const clearResponse = await app.request("/config/extensions/mcp/memory/defaults", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        default_access: "inherit",
        settings_text: "",
      }),
    });
    expect(clearResponse.status).toBe(200);
    await expect(clearResponse.json()).resolves.toMatchObject({
      item: {
        key: "memory",
        default_access: "inherit",
        default_mcp_server_settings_json: null,
      },
    });
  });

  it("parses MCP settings text via the extensions route", async () => {
    const response = await app.request("/config/extensions/mcp/parse-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings_format: "yaml",
        settings_text: `namespace: shared
limits:
  search: 5
`,
      }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      settings: {
        namespace: "shared",
        limits: {
          search: 5,
        },
      },
    });
  });

  it("requires a tenant-scoped token for MCP settings parsing", async () => {
    const adminOnlyApp = createApp(container, tenantId, {
      token_kind: "admin",
      token_id: "admin-token-1",
      role: "admin",
      scopes: ["*"],
    });

    const response = await adminOnlyApp.request("/config/extensions/mcp/parse-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings_format: "json",
        settings_text: '{"enabled":true}',
      }),
    });

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toBe("tenant token required");
  });
});
