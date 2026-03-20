import { isAbsolute, relative, resolve } from "node:path";
import type {
  AgentSecretReference as AgentSecretReferenceT,
  McpServerSpec as McpServerSpecT,
} from "@tyrum/contracts";
import type { NodeDispatchService, NodeInventoryService } from "@tyrum/runtime-node-control";
import type { ArtifactStore } from "../artifact/store.js";
import { requireTenantIdValue } from "../identity/scope.js";
import type { IdentityScopeDal } from "../identity/scope.js";
import type { RedactionEngine } from "../redaction/engine.js";
import type { SecretProvider } from "../secret/provider.js";
import type { SecretResolutionAuditDal } from "../secret/resolution-audit-dal.js";
import { acquireWorkspaceLease, releaseWorkspaceLease } from "../workspace/lease.js";
import type { AgentMemoryToolRuntime } from "../memory/agent-tool-runtime.js";
import { executeBuiltinMemoryMcpTool } from "../memory/builtin-mcp.js";
import type { LocationService } from "../location/service.js";
import { executeCoreTool, executeMcpTool } from "./tool-executor-core-tools.js";
import { executeLocationPlaceTool } from "./tool-executor-location-tools.js";
import { executeDedicatedNodeTool } from "./tool-executor-dedicated-node-tools.js";
import { executeSecretClipboardTool } from "./tool-executor-secret-tools.js";
import {
  executeDedicatedDesktopTool,
  executeNodeDispatchTool,
  executeNodeInspectTool,
  executeNodeListTool,
} from "./tool-executor-node-dispatch.js";
import { executeAutomationScheduleTool } from "./tool-executor-schedule-tools.js";
import { executeSubagentTool } from "./tool-executor-subagent-tools.js";
import { executeWorkboardTool } from "./tool-executor-workboard-tools.js";
import {
  executeArtifactDescribeTool,
  type ArtifactDescribeToolRuntime,
} from "./tool-executor-artifact-tools.js";
import type { McpManager } from "./mcp-manager.js";
import type { NodeCapabilityInspectionService } from "../node/capability-inspection-service.js";
import type { AgentRegistry } from "./registry.js";
import type { WorkboardBroadcastDeps } from "../workboard/item-broadcast.js";
import {
  DEFAULT_DNS_LOOKUP,
  type DnsLookupFn,
  type ToolExecutionAudit,
  type ToolResult,
  type WorkspaceLeaseConfig,
} from "./tool-executor-shared.js";

export { isBlockedUrl, resolvesToBlockedAddress, sanitizeEnv } from "./tool-executor-shared.js";
export type { ToolResult, ToolResultMeta, WorkspaceLeaseConfig } from "./tool-executor-shared.js";

const SECRET_HANDLE_PREFIX = "secret:";

type WorkspaceLeaseOptions = {
  ttlMs: number;
  waitMs: number;
};

export class ToolExecutor {
  constructor(
    private readonly home: string,
    private readonly mcpManager: McpManager,
    private readonly mcpServerSpecs: ReadonlyMap<string, McpServerSpecT>,
    private readonly fetchImpl: typeof fetch,
    private readonly secretProvider?: SecretProvider,
    private readonly dnsLookup: DnsLookupFn = DEFAULT_DNS_LOOKUP,
    private readonly redactionEngine?: RedactionEngine,
    private readonly secretResolutionAuditDal?: SecretResolutionAuditDal,
    private readonly workspaceLease?: WorkspaceLeaseConfig,
    private readonly nodeDispatchService?: NodeDispatchService,
    private readonly artifactStore?: ArtifactStore,
    private readonly identityScopeDal?: IdentityScopeDal,
    private readonly nodeInventoryService?: NodeInventoryService,
    private readonly nodeCapabilityInspectionService?: NodeCapabilityInspectionService,
    private readonly connectionManager?: import("../../ws/connection-manager.js").ConnectionManager,
    private readonly connectionDirectory?: import("../backplane/connection-directory.js").ConnectionDirectoryDal,
    private readonly memoryToolRuntime?: AgentMemoryToolRuntime,
    private readonly agents?: AgentRegistry,
    private readonly workboardBroadcastDeps?: WorkboardBroadcastDeps,
    private readonly artifactDescribeRuntime?: ArtifactDescribeToolRuntime,
    private readonly locationService?: LocationService,
    private readonly agentSecretRefs: readonly AgentSecretReferenceT[] = [],
  ) {}

  private workspaceLeaseOwner(toolCallId: string): string {
    const prefix = this.workspaceLease?.ownerPrefix?.trim() ?? "tool-executor";
    return `${prefix}:${toolCallId}`;
  }

  private assertSandboxed(filePath: string): string {
    const resolvedHome = resolve(this.home);
    const resolvedPath = resolve(resolvedHome, filePath);
    const rel = relative(resolvedHome, resolvedPath);
    if (rel !== "" && (rel.startsWith("..") || isAbsolute(rel))) {
      throw new Error(`path escapes workspace: ${filePath}`);
    }
    return resolvedPath;
  }

  private async withWorkspaceLease<T>(
    toolCallId: string,
    opts: WorkspaceLeaseOptions,
    fn: (ctx: { waitedMs: number }) => Promise<T>,
  ): Promise<T> {
    const lease = this.workspaceLease;
    if (!lease) return await fn({ waitedMs: 0 });

    const owner = this.workspaceLeaseOwner(toolCallId);
    const startedAtMs = Date.now();
    const acquired = await acquireWorkspaceLease(lease.db, {
      tenantId: lease.tenantId,
      workspaceId: lease.workspaceId,
      owner,
      ttlMs: Math.max(1, Math.floor(opts.ttlMs)),
      waitMs: Math.max(0, Math.floor(opts.waitMs)),
    });
    const waitedMs = Math.max(0, Date.now() - startedAtMs);
    if (!acquired) {
      throw new Error("workspace is busy");
    }

    try {
      return await fn({ waitedMs });
    } finally {
      await releaseWorkspaceLease(lease.db, {
        tenantId: lease.tenantId,
        workspaceId: lease.workspaceId,
        owner,
      }).catch(() => {
        // Best-effort: leases expire and can be taken over.
      });
    }
  }

  async execute(
    toolId: string,
    toolCallId: string,
    args: unknown,
    audit?: ToolExecutionAudit,
  ): Promise<ToolResult> {
    try {
      const { resolved, secrets } = await this.resolveSecrets(args, {
        tool_call_id: toolCallId,
        tool_id: toolId,
        ...audit,
      });
      this.redactionEngine?.registerSecrets(secrets);
      return this.redactResult(
        await this.dispatchTool(toolId, toolCallId, resolved, audit),
        secrets,
      );
    } catch (err) {
      return {
        tool_call_id: toolCallId,
        output: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async dispatchTool(
    toolId: string,
    toolCallId: string,
    args: unknown,
    audit?: ToolExecutionAudit,
  ): Promise<ToolResult> {
    const coreContext = {
      home: this.home,
      fetchImpl: this.fetchImpl,
      dnsLookup: this.dnsLookup,
      mcpManager: this.mcpManager,
      mcpServerSpecs: this.mcpServerSpecs,
      secretProvider: this.secretProvider,
      assertSandboxed: (filePath: string) => this.assertSandboxed(filePath),
      withWorkspaceLease: <T>(
        callId: string,
        opts: WorkspaceLeaseOptions,
        fn: (ctx: { waitedMs: number }) => Promise<T>,
      ) => this.withWorkspaceLease(callId, opts, fn),
    };

    if (toolId.startsWith("mcp.")) {
      const builtinMemoryResult = await executeBuiltinMemoryMcpTool({
        runtime: this.memoryToolRuntime,
        toolId,
        toolCallId,
        args,
      });
      if (builtinMemoryResult) {
        return builtinMemoryResult;
      }
      return await executeMcpTool(coreContext, toolId, toolCallId, args);
    }
    const dedicatedNodeResult = await executeDedicatedNodeTool(
      {
        workspaceLease: this.workspaceLease,
        nodeDispatchService: this.nodeDispatchService,
        nodeInventoryService: this.nodeInventoryService,
        inspectionService: this.nodeCapabilityInspectionService,
        connectionManager: this.connectionManager,
        connectionDirectory: this.connectionDirectory,
        artifactStore: this.artifactStore,
      },
      toolId,
      toolCallId,
      args,
      audit,
    );
    if (dedicatedNodeResult) {
      return dedicatedNodeResult;
    }
    const secretClipboardResult = await executeSecretClipboardTool(
      {
        workspaceLease: this.workspaceLease,
        nodeDispatchService: this.nodeDispatchService,
        nodeInventoryService: this.nodeInventoryService,
        inspectionService: this.nodeCapabilityInspectionService,
        connectionManager: this.connectionManager,
        connectionDirectory: this.connectionDirectory,
        artifactStore: this.artifactStore,
        secretProvider: this.secretProvider,
        agentSecretRefs: this.agentSecretRefs,
      },
      toolCallId,
      args,
      audit,
    );
    if (secretClipboardResult) {
      this.redactionEngine?.registerSecrets(secretClipboardResult.secrets);
      return this.redactResult(secretClipboardResult.result, secretClipboardResult.secrets);
    }
    if (toolId === "tool.node.dispatch") {
      if (!this.nodeDispatchService) {
        return {
          tool_call_id: toolCallId,
          output: "",
          error: "node dispatch is not configured",
        };
      }
      if (!this.nodeCapabilityInspectionService) {
        return {
          tool_call_id: toolCallId,
          output: "",
          error: "node capability inspection is not configured",
        };
      }
      return await executeNodeDispatchTool(
        {
          workspaceLease: this.workspaceLease,
          nodeDispatchService: this.nodeDispatchService,
          inspectionService: this.nodeCapabilityInspectionService,
          connectionManager: this.connectionManager,
          connectionDirectory: this.connectionDirectory,
          artifactStore: this.artifactStore,
        },
        toolCallId,
        args,
        audit,
      );
    }
    if (toolId === "tool.node.list") {
      return this.nodeInventoryService
        ? await executeNodeListTool(
            {
              workspaceLease: this.workspaceLease,
              nodeInventoryService: this.nodeInventoryService,
            },
            toolCallId,
            args,
            audit,
          )
        : {
            tool_call_id: toolCallId,
            output: "",
            error: "node inventory is not configured",
          };
    }
    if (toolId === "tool.node.inspect") {
      return this.nodeCapabilityInspectionService
        ? await executeNodeInspectTool(
            {
              workspaceLease: this.workspaceLease,
              inspectionService: this.nodeCapabilityInspectionService,
            },
            toolCallId,
            args,
          )
        : {
            tool_call_id: toolCallId,
            output: "",
            error: "node capability inspection is not configured",
          };
    }
    const dedicatedDesktopResult = await executeDedicatedDesktopTool(
      {
        workspaceLease: this.workspaceLease,
        nodeDispatchService: this.nodeDispatchService,
        nodeInventoryService: this.nodeInventoryService,
        inspectionService: this.nodeCapabilityInspectionService,
        connectionManager: this.connectionManager,
        connectionDirectory: this.connectionDirectory,
        artifactStore: this.artifactStore,
      },
      toolId,
      toolCallId,
      args,
      audit,
    );
    if (dedicatedDesktopResult) {
      return dedicatedDesktopResult;
    }
    const artifactDescribeResult = await executeArtifactDescribeTool(
      this.artifactDescribeRuntime,
      toolId,
      toolCallId,
      args,
    );
    if (artifactDescribeResult) {
      return artifactDescribeResult;
    }

    const scheduleResult = await executeAutomationScheduleTool(
      {
        workspaceLease: this.workspaceLease,
        identityScopeDal: this.identityScopeDal,
      },
      toolId,
      toolCallId,
      args,
    );
    if (scheduleResult) {
      return scheduleResult;
    }

    const locationPlaceResult = await executeLocationPlaceTool(
      {
        workspaceLease: this.workspaceLease,
        identityScopeDal: this.identityScopeDal,
        locationService: this.locationService,
      },
      toolId,
      toolCallId,
      args,
    );
    if (locationPlaceResult) {
      return locationPlaceResult;
    }

    const subagentResult = await executeSubagentTool(
      {
        workspaceLease: this.workspaceLease,
        agents: this.agents,
      },
      toolId,
      toolCallId,
      args,
      audit,
    );
    if (subagentResult) {
      return subagentResult;
    }

    const workboardResult = await executeWorkboardTool(
      {
        workspaceLease: this.workspaceLease,
        agents: this.agents,
        broadcastDeps: this.workboardBroadcastDeps,
      },
      toolId,
      toolCallId,
      args,
      audit,
    );
    if (workboardResult) {
      return workboardResult;
    }

    const coreResult = await executeCoreTool(coreContext, toolId, toolCallId, args);
    return (
      coreResult ?? {
        tool_call_id: toolCallId,
        output: "",
        error: `unknown tool: ${toolId}`,
      }
    );
  }

  private async resolveSecrets(
    args: unknown,
    audit?: ToolExecutionAudit & { tool_call_id: string; tool_id: string },
  ): Promise<{ resolved: unknown; secrets: string[] }> {
    const provider = this.secretProvider;
    if (!provider) {
      return { resolved: args, secrets: [] };
    }

    const secrets: string[] = [];
    const walk = async (value: unknown): Promise<unknown> => {
      if (typeof value === "string" && value.startsWith(SECRET_HANDLE_PREFIX)) {
        const handleId = value.slice(SECRET_HANDLE_PREFIX.length);
        const handle = {
          handle_id: handleId,
          provider: "db" as const,
          scope: handleId,
          created_at: new Date().toISOString(),
        };
        const resolved = await provider.resolve(handle);
        await this.recordSecretResolutionAudit(audit, handle, resolved);
        if (resolved !== null) {
          secrets.push(resolved);
          return resolved;
        }
        return value;
      }
      if (Array.isArray(value)) {
        return Promise.all(value.map(walk));
      }
      if (value !== null && typeof value === "object") {
        const result: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
          result[key] = await walk(entry);
        }
        return result;
      }
      return value;
    };

    return { resolved: await walk(args), secrets };
  }

  private async recordSecretResolutionAudit(
    audit: (ToolExecutionAudit & { tool_call_id: string; tool_id: string }) | undefined,
    handle: { handle_id: string; provider: "db"; scope: string },
    resolved: string | null,
  ): Promise<void> {
    if (!audit || !this.secretResolutionAuditDal) return;
    const tenantId = requireTenantIdValue(
      this.workspaceLease?.tenantId,
      "tenantId is required for secret resolution audit",
    );
    try {
      await this.secretResolutionAuditDal.record({
        tenantId,
        toolCallId: audit.tool_call_id,
        toolId: audit.tool_id,
        handleId: handle.handle_id,
        provider: handle.provider,
        scope: handle.scope,
        agentId: audit.agent_id,
        workspaceId: audit.workspace_id,
        sessionId: audit.session_id,
        channel: audit.channel,
        threadId: audit.thread_id,
        policySnapshotId: audit.policy_snapshot_id,
        outcome: resolved !== null ? "resolved" : "failed",
        error: resolved !== null ? undefined : "secret provider returned null",
      });
    } catch {
      // Intentional: ignore audit-write failures so tool execution is not blocked by logging.
    }
  }

  private redactResult(result: ToolResult, secrets: string[]): ToolResult {
    if (secrets.length === 0) return result;

    const redact = (text: string): string => {
      if (this.redactionEngine) {
        return this.redactionEngine.redactText(text).redacted;
      }
      return this.redactValues(text, secrets);
    };

    return {
      ...result,
      output: result.output ? redact(result.output) : result.output,
      error: result.error ? redact(result.error) : result.error,
      provenance: result.provenance
        ? {
            ...result.provenance,
            content: redact(result.provenance.content),
          }
        : result.provenance,
    };
  }

  private redactValues(text: string, secrets: string[]): string {
    let result = text;
    for (const secret of secrets) {
      if (secret.length > 0) {
        result = result.replaceAll(secret, "[REDACTED]");
      }
    }
    return result;
  }
}
