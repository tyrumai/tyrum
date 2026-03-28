import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const repoRoot = resolve(__dirname, "../..");
export const httpSourceDir = join(repoRoot, "packages/transport-sdk/src/http");
export const gatewayRoutesDir = join(repoRoot, "packages/gateway/src/routes");
export const contractsDistDir = join(repoRoot, "packages/contracts/dist");
export const contractsDistEntrypointPath = join(contractsDistDir, "index.mjs");
export const contractsCatalogPath = join(contractsDistDir, "jsonschema/catalog.json");
export const docsApiReferencePath = join(repoRoot, "docs/api-reference.md");
export const openApiSpecPath = join(repoRoot, "specs/openapi.json");
export const asyncApiSpecPath = join(repoRoot, "specs/asyncapi.json");
export const gatewayApiManifestPath = join(
  repoRoot,
  "packages/gateway/src/api/manifest.generated.json",
);
export const wsClientSourcePath = join(repoRoot, "packages/transport-sdk/src/ws-client.ts");
export const wsClientGeneratedPath = join(
  repoRoot,
  "packages/transport-sdk/src/ws-client.generated.ts",
);
export const wsClientTypesGeneratedPath = join(
  repoRoot,
  "packages/transport-sdk/src/ws-client.types.generated.ts",
);
export const httpGeneratedDir = join(repoRoot, "packages/transport-sdk/src/http/generated");
export const httpClientGeneratedPath = join(httpGeneratedDir, "client.generated.ts");

export const HTTP_SOURCE_EXCLUDES = new Set([
  "client.ts",
  "client.generated.ts",
  "config-delete-response.ts",
  "index.ts",
  "shared.ts",
]);

export const HTTP_PUBLIC_ALLOWLIST = new Set([
  "GET /healthz",
  "GET /ui",
  "GET /ui/*",
  "POST /auth/cookie",
  "POST /auth/logout",
]);

export const WS_SERVER_INITIATED_REQUEST_TYPES = new Set(["task.execute"]);

export const MANUAL_HTTP_ROUTE_ENTRIES = [
  { method: "GET", path: "/ui", sourceFile: "operator-ui.ts" },
  { method: "GET", path: "/ui/*", sourceFile: "operator-ui.ts" },
  {
    method: "POST",
    path: "/desktop-environments/{environmentId}/start",
    sourceFile: "desktop-environments.ts",
  },
  {
    method: "POST",
    path: "/desktop-environments/{environmentId}/stop",
    sourceFile: "desktop-environments.ts",
  },
  {
    method: "POST",
    path: "/desktop-environments/{environmentId}/reset",
    sourceFile: "desktop-environments.ts",
  },
  { method: "GET", path: "/config/policy/deployment", sourceFile: "gateway-config.ts" },
  { method: "GET", path: "/config/policy/deployment/revisions", sourceFile: "gateway-config.ts" },
  { method: "PUT", path: "/config/policy/deployment", sourceFile: "gateway-config.ts" },
  { method: "POST", path: "/config/policy/deployment/revert", sourceFile: "gateway-config.ts" },
  { method: "GET", path: "/config/policy/agents/{key}", sourceFile: "gateway-config.ts" },
  {
    method: "GET",
    path: "/config/policy/agents/{key}/revisions",
    sourceFile: "gateway-config.ts",
  },
  { method: "PUT", path: "/config/policy/agents/{key}", sourceFile: "gateway-config.ts" },
  {
    method: "POST",
    path: "/config/policy/agents/{key}/revert",
    sourceFile: "gateway-config.ts",
  },
];
