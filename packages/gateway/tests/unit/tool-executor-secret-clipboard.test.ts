import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolExecutor } from "../../src/modules/agent/tool-executor.js";
import { DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID } from "../../src/modules/identity/scope.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import {
  allowPublicDnsLookup,
  createClipboardAgentSecretRef,
  stubMcpManager,
  stubSecretProvider,
} from "./tool-executor.secret-test-support.js";

describe("ToolExecutor secret clipboard delivery", () => {
  let homeDir: string | undefined;
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it("copies an allowlisted secret alias to a clipboard-capable node without exposing plaintext", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tool-executor-secret-"));
    db = openTestSqliteDb();

    const provider = stubSecretProvider(new Map([["sec-ref-db", "super-secret-token"]]));
    const nodeDispatchService = {
      dispatchAndWait: vi.fn(async () => ({
        taskId: "task-clipboard-1",
        result: {
          ok: true,
          result: { op: "clipboard_write", status: "ok" },
        },
      })),
    };
    const nodeInventoryService = {
      list: vi.fn(async () => ({
        key: undefined,
        lane: undefined,
        nodes: [
          {
            node_id: "node-clipboard-1",
            connected: true,
            paired_status: "approved",
            attached_to_requested_lane: false,
            capabilities: [
              {
                capability: "tyrum.desktop.clipboard-write",
                dispatchable: true,
                capability_version: "1.0.0",
                connected: true,
                ready: true,
                paired: true,
                supported_action_count: 1,
                enabled_action_count: 1,
                available_action_count: 1,
                unknown_action_count: 0,
              },
            ],
          },
        ],
      })),
    };
    const inspectionService = {
      inspect: vi.fn(async () => ({
        status: "ok",
        generated_at: new Date().toISOString(),
        node_id: "node-clipboard-1",
        capability: "tyrum.desktop.clipboard-write",
        capability_version: "1.0.0",
        connected: true,
        paired: true,
        dispatchable: true,
        source_of_truth: {
          schema: "gateway_catalog",
          state: "node_capability_state",
        },
        actions: [
          {
            name: "clipboard_write",
            description: "Write text to the node clipboard.",
            supported: true,
            enabled: true,
            availability_status: "available",
            input_schema: {},
            output_schema: {},
            consent: {
              requires_operator_enable: false,
              requires_runtime_consent: false,
              may_prompt_user: true,
              sensitive_data_category: "none",
            },
            permissions: { browser_apis: [] },
            transport: {
              primitive_kind: "Desktop",
              op_field: "op",
              op_value: "clipboard_write",
              result_channel: "result_or_evidence",
              artifactize_binary_fields: [],
            },
          },
        ],
      })),
    };

    const executor = new ToolExecutor(
      homeDir,
      stubMcpManager(),
      new Map(),
      fetch,
      provider,
      allowPublicDnsLookup,
      undefined,
      undefined,
      {
        db,
        tenantId: DEFAULT_TENANT_ID,
        agentId: "default",
        workspaceId: DEFAULT_WORKSPACE_ID,
      },
      nodeDispatchService as never,
      undefined,
      undefined,
      nodeInventoryService as never,
      inspectionService as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      [createClipboardAgentSecretRef({ display_name: "Production DB password" })],
    );

    const result = await executor.execute(
      "tool.secret.copy-to-node-clipboard",
      "call-clipboard-1",
      {
        secret_alias: "prod-db-password",
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.output).toContain('"secret_ref_id":"sec-ref-db"');
    expect(result.output).toContain('"secret_alias":"prod-db-password"');
    expect(result.output).toContain('"selected_node_id":"node-clipboard-1"');
    expect(result.output).not.toContain("super-secret-token");
    expect(nodeDispatchService.dispatchAndWait).toHaveBeenCalledWith(
      {
        type: "Desktop",
        args: {
          op: "clipboard_write",
          text: "super-secret-token",
        },
      },
      expect.any(Object),
      { timeoutMs: 30_000, nodeId: "node-clipboard-1" },
    );
  });

  it("fails secret clipboard delivery when more than one eligible clipboard node exists", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tool-executor-secret-"));
    db = openTestSqliteDb();

    const provider = stubSecretProvider(new Map([["sec-ref-db", "super-secret-token"]]));
    const nodeDispatchService = {
      dispatchAndWait: vi.fn(async () => {
        throw new Error("should not dispatch");
      }),
    };
    const nodeInventoryService = {
      list: vi.fn(async () => ({
        key: undefined,
        lane: undefined,
        nodes: [
          {
            node_id: "node-clipboard-1",
            connected: true,
            paired_status: "approved",
            attached_to_requested_lane: true,
            capabilities: [],
          },
          {
            node_id: "node-clipboard-2",
            connected: true,
            paired_status: "approved",
            attached_to_requested_lane: false,
            capabilities: [],
          },
        ],
      })),
    };

    const executor = new ToolExecutor(
      homeDir,
      stubMcpManager(),
      new Map(),
      fetch,
      provider,
      allowPublicDnsLookup,
      undefined,
      undefined,
      {
        db,
        tenantId: DEFAULT_TENANT_ID,
        agentId: "default",
        workspaceId: DEFAULT_WORKSPACE_ID,
      },
      nodeDispatchService as never,
      undefined,
      undefined,
      nodeInventoryService as never,
      {
        inspect: vi.fn(async () => {
          throw new Error("should not inspect");
        }),
      } as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      [createClipboardAgentSecretRef()],
    );

    const result = await executor.execute(
      "tool.secret.copy-to-node-clipboard",
      "call-clipboard-2",
      {
        secret_alias: "prod-db-password",
      },
    );

    expect(result.output).toBe("");
    expect(result.error).toBe(
      "ambiguous node selection for 'tool.secret.copy-to-node-clipboard'; provide node_id when multiple eligible clipboard-capable nodes exist",
    );
    expect(nodeDispatchService.dispatchAndWait).not.toHaveBeenCalled();
  });

  it("does not intercept unrelated tool calls when agent secret refs are configured", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tool-executor-secret-"));
    db = openTestSqliteDb();

    const filePath = join(homeDir, "notes.txt");
    await writeFile(filePath, "dispatch still works\n", "utf8");

    const executor = new ToolExecutor(
      homeDir,
      stubMcpManager(),
      new Map(),
      fetch,
      stubSecretProvider(new Map([["sec-ref-db", "super-secret-token"]])),
      allowPublicDnsLookup,
      undefined,
      undefined,
      {
        db,
        tenantId: DEFAULT_TENANT_ID,
        agentId: "default",
        workspaceId: DEFAULT_WORKSPACE_ID,
      },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      [createClipboardAgentSecretRef()],
    );

    const result = await executor.execute("read", "call-read-1", { path: "notes.txt" });

    expect(result.error).toBeUndefined();
    expect(result.output).toContain("dispatch still works");
  });

  it("returns a configuration error when the secret clipboard tool has no configured refs", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tool-executor-secret-"));

    const executor = new ToolExecutor(
      homeDir,
      stubMcpManager(),
      new Map(),
      fetch,
      undefined,
      allowPublicDnsLookup,
    );

    const result = await executor.execute(
      "tool.secret.copy-to-node-clipboard",
      "call-clipboard-no-refs",
      {
        secret_alias: "prod-db-password",
      },
    );

    expect(result.output).toBe("");
    expect(result.error).toBe(
      "no secret references configured for 'tool.secret.copy-to-node-clipboard'",
    );
  });
});
