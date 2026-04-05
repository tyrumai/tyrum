import { expect } from "vitest";
import { createApp } from "../../src/app.js";
import type { GatewayContainer } from "../../src/container.js";
import { ToolExecutor } from "../../src/modules/agent/tool-executor.js";
import { AuthTokenService } from "../../src/modules/auth/auth-token-service.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import type { NodeCapabilityInspectionService } from "../../src/modules/node/capability-inspection-service.js";
import { createTestContainer, decorateAppWithDefaultAuth } from "./helpers.js";
import {
  createDesktopInspectionService,
  stubMcpManager,
} from "./node-dispatch-desktop-artifacts-test-support.js";

type ArtifactFetchApp = Pick<ReturnType<typeof createApp>, "request">;
type ArtifactParentKind = "execution_run" | "workflow_run_step" | "dispatch_record";
type ArtifactQueryDb = Pick<GatewayContainer["db"], "get">;
type NodeDispatchServiceLike = {
  dispatchAndWait: (...args: unknown[]) => Promise<{ taskId: string; result: unknown }>;
};

export async function createNodeDispatchHarness(input: {
  homeDir: string;
  nodeId: string;
  service: NodeDispatchServiceLike;
}): Promise<{
  app: ArtifactFetchApp;
  container: GatewayContainer;
  executor: ToolExecutor;
}> {
  const container = await createTestContainer();
  const authTokens = new AuthTokenService(container.db);
  const tenantToken = await authTokens.issueToken({
    tenantId: DEFAULT_TENANT_ID,
    role: "admin",
    scopes: ["*"],
  });
  const app = createApp(container, { authTokens });
  decorateAppWithDefaultAuth(app, tenantToken.token);

  const executor = new ToolExecutor(
    input.homeDir,
    stubMcpManager(),
    new Map(),
    fetch,
    undefined,
    undefined,
    container.redactionEngine,
    undefined,
    {
      db: container.db,
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      ownerPrefix: "test-tool",
    },
    input.service as never,
    container.artifactStore,
    undefined,
    undefined,
    createDesktopInspectionService(input.nodeId) as NodeCapabilityInspectionService,
  );

  return { app, container, executor };
}

export function parseTaggedToolOutput(output: string): Record<string, unknown> {
  const trimmed = output.trim();
  const match = trimmed.match(/^<data source="tool">\s*([\s\S]*)\s*<\/data>$/);
  return JSON.parse((match?.[1] ?? trimmed).trim()) as Record<string, unknown>;
}

export async function findLatestArtifactId(
  db: ArtifactQueryDb,
  input: {
    kind: string;
    parentId: string;
    parentKind: ArtifactParentKind;
    tenantId: string;
  },
): Promise<string> {
  const row = await db.get<{ artifact_id: string }>(
    `SELECT a.artifact_id
     FROM artifacts a
     INNER JOIN artifact_links l
       ON l.tenant_id = a.tenant_id
      AND l.artifact_id = a.artifact_id
      AND l.parent_kind = ?
      AND l.parent_id = ?
     WHERE a.tenant_id = ?
       AND a.kind = ?
     ORDER BY a.created_at DESC
     LIMIT 1`,
    [input.parentKind, input.parentId, input.tenantId, input.kind],
  );
  expect(row).toBeTruthy();
  if (!row) {
    throw new Error(
      `expected ${input.kind} artifact linked to ${input.parentKind}:${input.parentId}`,
    );
  }
  return row.artifact_id;
}

export async function expectBinaryArtifactResponse(
  app: ArtifactFetchApp,
  artifactId: string,
  mimeType: string,
  expectedBytes: Buffer,
): Promise<void> {
  const res = await app.request(`/a/${artifactId}`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe(mimeType);
  expect(Buffer.from(await res.arrayBuffer())).toEqual(expectedBytes);
}

export async function expectJsonArtifactResponse(
  app: ArtifactFetchApp,
  artifactId: string,
  mimeType: string,
  expectedJson: unknown,
): Promise<void> {
  const res = await app.request(`/a/${artifactId}`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe(mimeType);
  expect(await res.json()).toEqual(expectedJson);
}
