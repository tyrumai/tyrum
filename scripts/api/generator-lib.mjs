import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { extractHttpCatalog } from "./http-introspection.mjs";
import {
  asyncApiSpecPath,
  docsApiReferencePath,
  gatewayApiManifestPath,
  httpClientGeneratedPath,
  httpGeneratedDir,
  openApiSpecPath,
  wsClientGeneratedPath,
  wsClientTypesGeneratedPath,
} from "./paths.mjs";
import {
  buildAsyncApiSpec,
  buildOpenApiSpec,
  renderHttpDocs,
  renderWsDocs,
} from "./spec-renderers.mjs";
import {
  renderHttpGeneratedClient,
  renderHttpGeneratedModules,
  renderWsClientGenerated,
  renderWsClientTypesSource,
} from "./sdk-renderers.mjs";
import { stableJsonStringify } from "./source-utils.mjs";
import { extractWsCatalog, readWsClientTemplate } from "./ws-introspection.mjs";

function renderApiReference(httpCatalog, wsCatalog) {
  return `${renderHttpDocs(httpCatalog.operations)}\n\n${renderWsDocs(wsCatalog)}\n`;
}

function buildGatewayManifest(httpCatalog, wsCatalog) {
  return {
    http: httpCatalog.operations,
    ws: wsCatalog,
  };
}

export async function generateApiArtifacts() {
  const [httpCatalog, wsCatalog, wsClientTemplate] = await Promise.all([
    extractHttpCatalog(),
    extractWsCatalog(),
    readWsClientTemplate(),
  ]);

  const [openApi, asyncApi] = await Promise.all([
    buildOpenApiSpec(httpCatalog.operations),
    buildAsyncApiSpec(wsCatalog),
  ]);

  const manifest = buildGatewayManifest(httpCatalog, wsCatalog);
  const files = [
    {
      path: docsApiReferencePath,
      content: renderApiReference(httpCatalog, wsCatalog),
    },
    {
      path: openApiSpecPath,
      content: stableJsonStringify(openApi),
    },
    {
      path: asyncApiSpecPath,
      content: stableJsonStringify(asyncApi),
    },
    {
      path: gatewayApiManifestPath,
      content: stableJsonStringify(manifest),
    },
    {
      path: wsClientGeneratedPath,
      content: renderWsClientGenerated(wsClientTemplate),
    },
    {
      path: wsClientTypesGeneratedPath,
      content: renderWsClientTypesSource(),
    },
    {
      path: httpClientGeneratedPath,
      content: renderHttpGeneratedClient(httpCatalog),
    },
    ...renderHttpGeneratedModules(httpCatalog),
  ];

  return {
    files,
    metadata: {
      httpOperationCount: httpCatalog.operations.length,
      wsRequestCount: wsCatalog.requests.length,
      wsEventCount: wsCatalog.events.length,
    },
  };
}

export async function writeApiArtifacts() {
  const generated = await generateApiArtifacts();
  await mkdir(httpGeneratedDir, { recursive: true });
  for (const file of generated.files) {
    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(file.path, file.content, "utf8");
  }
  return generated;
}
