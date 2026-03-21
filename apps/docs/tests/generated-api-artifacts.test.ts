import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

describe("generated API artifacts", () => {
  it("match the generator output", async () => {
    const generator = await import(
      pathToFileURL(resolve(repoRoot, "scripts/api/generator-lib.mjs")).href
    );
    const generated = await generator.generateApiArtifacts();

    for (const file of generated.files as Array<{ path: string; content: string }>) {
      const existing = await readFile(file.path, "utf8");
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
    const generator = await import(
      pathToFileURL(resolve(repoRoot, "scripts/api/generator-lib.mjs")).href
    );
    const generated = await generator.generateApiArtifacts();
    const files = generated.files as Array<{ path: string; content: string }>;

    const manifest = JSON.parse(
      files.find((file) => file.path.endsWith("packages/gateway/src/api/manifest.generated.json"))
        ?.content ?? "null",
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

    const openApi = JSON.parse(
      files.find((file) => file.path.endsWith("specs/openapi.json"))?.content ?? "null",
    ) as {
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

    const apiReference = files.find((file) => file.path.endsWith("docs/api-reference.md"))?.content;
    expect(apiReference).toContain("#### DELETE /secrets/\\{id\\}");
    expect(apiReference).toContain("- Query schema: `SecretListQuery`");
    expect(apiReference).not.toContain(
      "#### DELETE /secrets/\\{id\\}\n\n- SDK operation: `secrets.revoke`\n- Auth: Required\n- Device scope: operator.admin\n- Request body schema: `SecretListQuery`",
    );
  });
});
