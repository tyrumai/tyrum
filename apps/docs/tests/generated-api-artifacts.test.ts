import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateApiArtifacts } from "../../../scripts/api/generator-lib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

describe("generated API artifacts", () => {
  it("match the generator output", async () => {
    const generated = await generateApiArtifacts();
    for (const file of generated.files) {
      const existing = await readFile(file.path, "utf8").catch(() => "");
      expect(existing).toBe(file.content);
    }
  }, 30_000);

  it("generate OpenAPI paths only for valid HTTP routes", async () => {
    const openApi = JSON.parse(await readFile(resolve(repoRoot, "specs/openapi.json"), "utf8")) as {
      paths?: Record<string, unknown>;
    };
    const paths = Object.keys(openApi.paths ?? {});

    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path.startsWith("/")).toBe(true);
    }
    expect(paths).not.toContain("authClaims");
    expect(paths).not.toContain("x-request-id");
    expect(paths).not.toContain(
      "SELECT plan_id FROM plans WHERE tenant_id = ? AND plan_id = ? FOR UPDATE",
    );
  });

  it("does not emit a request body for DELETE routes that only validate query parameters", async () => {
    const manifest = JSON.parse(
      await readFile(resolve(repoRoot, "packages/gateway/src/api/manifest.generated.json"), "utf8"),
    ) as {
      http?: Array<{
        method?: string;
        path?: string;
        querySchemaName?: string;
        bodySchemaName?: string;
      }>;
    };
    const revokeOperation = manifest.http?.find(
      (operation) => operation.method === "DELETE" && operation.path === "/secrets/{id}",
    );
    expect(revokeOperation).toMatchObject({
      method: "DELETE",
      path: "/secrets/{id}",
      querySchemaName: "SecretListQuery",
    });
    expect(revokeOperation?.bodySchemaName).toBeUndefined();

    const openApi = JSON.parse(await readFile(resolve(repoRoot, "specs/openapi.json"), "utf8")) as {
      paths?: Record<
        string,
        {
          delete?: {
            requestBody?: unknown;
            parameters?: Array<{ name?: string; in?: string; schema?: { $ref?: string } }>;
          };
        }
      >;
    };
    const deleteSecretsOperation = openApi.paths?.["/secrets/{id}"]?.delete;
    expect(deleteSecretsOperation?.requestBody).toBeUndefined();
    expect(deleteSecretsOperation?.parameters).toContainEqual({
      name: "query",
      in: "query",
      required: false,
      schema: { $ref: "#/components/schemas/SecretListQuery" },
    });

    const apiReference = await readFile(resolve(repoRoot, "docs/api-reference.md"), "utf8");
    expect(apiReference).toContain("#### DELETE /secrets/\\{id\\}");
    expect(apiReference).toContain("- Query schema: `SecretListQuery`");
    expect(apiReference).not.toContain(
      "#### DELETE /secrets/\\{id\\}\n\n- SDK operation: `secrets.revoke`\n- Auth: Required\n- Device scope: operator.admin\n- Request body schema: `SecretListQuery`",
    );
  });

  it("publishes workflow.start and turn.* execution vocabulary only", async () => {
    const manifest = JSON.parse(
      await readFile(resolve(repoRoot, "packages/gateway/src/api/manifest.generated.json"), "utf8"),
    ) as {
      http?: Array<{ method?: string; path?: string }>;
      ws?: { events?: Array<{ type?: string }> };
    };

    expect(
      manifest.http?.some(
        (operation) => operation.method === "POST" && operation.path === "/workflow/start",
      ),
    ).toBe(true);
    expect(
      manifest.http?.some(
        (operation) => operation.method === "POST" && operation.path === "/workflow/run",
      ),
    ).toBe(false);

    const eventTypes = new Set(manifest.ws?.events?.map((event) => event.type) ?? []);
    expect(eventTypes.has("turn.updated")).toBe(true);
    for (const deprecatedType of [
      "run.cancelled",
      "run.completed",
      "run.failed",
      "run.paused",
      "run.queued",
      "run.resumed",
      "run.started",
      "run.updated",
    ]) {
      expect(eventTypes.has(deprecatedType)).toBe(false);
    }

    const apiReference = await readFile(resolve(repoRoot, "docs/api-reference.md"), "utf8");
    expect(apiReference).toContain("#### POST /workflow/start");
    expect(apiReference).not.toContain("#### POST /workflow/run");
  });
});
