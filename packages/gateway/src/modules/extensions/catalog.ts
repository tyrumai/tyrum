import {
  AgentConfig,
  type ManagedExtensionDetail,
  type ManagedExtensionSourceDescriptor,
  type ManagedExtensionSummary,
} from "@tyrum/schemas";
import { RuntimePackageDal, type RuntimePackageRevision } from "../agent/runtime-package-dal.js";
import { isAgentAccessAllowed } from "../agent/access-config.js";
import {
  ensureManagedExtensionMaterialized,
  parseManagedMcpPackage,
  parseManagedSkillPackage,
} from "./managed.js";
import type { ExtensionKind, ExtensionStateMode } from "./service.js";
import type { SqlDb } from "../../statestore/types.js";

export async function listLatestAgentConfigs(db: SqlDb, tenantId: string): Promise<AgentConfig[]> {
  const rows = await db.all<{ config_json: string }>(
    `SELECT current.config_json
     FROM agent_configs current
     WHERE current.tenant_id = ?
       AND current.revision = (
         SELECT MAX(inner_cfg.revision)
         FROM agent_configs inner_cfg
         WHERE inner_cfg.tenant_id = current.tenant_id
           AND inner_cfg.agent_id = current.agent_id
       )`,
    [tenantId],
  );
  return rows.flatMap((row) => {
    try {
      const parsed = AgentConfig.safeParse(JSON.parse(row.config_json) as unknown);
      return parsed.success ? [parsed.data] : [];
    } catch (error) {
      void error;
      return [];
    }
  });
}

export function countAssignments(
  configs: readonly AgentConfig[],
  kind: ExtensionKind,
  key: string,
): number {
  return configs.filter((config) => {
    const accessConfig = kind === "skill" ? config.skills : config.mcp;
    return isAgentAccessAllowed({ ...accessConfig, default_mode: "deny" }, key);
  }).length;
}

function sourceDescriptorForSkill(
  source: ReturnType<typeof parseManagedSkillPackage>["source"],
): ManagedExtensionSourceDescriptor {
  return source.kind === "direct-url"
    ? {
        kind: "direct-url",
        url: source.url,
        filename: source.filename ?? null,
      }
    : {
        kind: "upload",
        filename: source.filename ?? null,
      };
}

function sourceDescriptorForMcp(
  source: ReturnType<typeof parseManagedMcpPackage>["source"],
): ManagedExtensionSourceDescriptor {
  if (source.kind === "direct-url") {
    return {
      kind: "direct-url",
      url: source.url,
      mode: source.mode,
      filename: source.filename ?? null,
    };
  }
  if (source.kind === "npm") {
    return {
      kind: "npm",
      npm_spec: source.npm_spec,
      command: source.command,
      args: source.args,
    };
  }
  return {
    kind: "upload",
    filename: source.filename ?? null,
  };
}

export async function buildExtensionSummary(input: {
  tenantId: string;
  stateMode: ExtensionStateMode;
  home: string;
  kind: ExtensionKind;
  revision: RuntimePackageRevision;
  assignmentCount: number;
}): Promise<ManagedExtensionSummary> {
  const sourceType = input.stateMode === "shared" ? "shared" : "managed";
  if (input.kind === "skill") {
    const pkg = parseManagedSkillPackage(input.revision.packageData, input.revision.packageKey);
    const materializedPath = await ensureManagedExtensionMaterialized({
      home: input.home,
      tenantId: input.tenantId,
      stateMode: input.stateMode,
      kind: "skill",
      revision: input.revision,
    });
    return {
      kind: "skill",
      key: pkg.key,
      name: pkg.manifest.meta.name,
      description: pkg.manifest.meta.description ?? null,
      version: pkg.manifest.meta.version ?? null,
      enabled: input.revision.enabled,
      revision: input.revision.revision,
      source: sourceDescriptorForSkill(pkg.source),
      source_type: sourceType,
      refreshable: pkg.source.kind === "direct-url",
      materialized_path: materializedPath ?? null,
      assignment_count: input.assignmentCount,
      transport: null,
      default_access: "inherit",
      can_edit_settings: false,
      can_toggle_source_enabled: true,
      can_refresh_source: pkg.source.kind === "direct-url",
      can_revert_source: true,
    };
  }

  const pkg = parseManagedMcpPackage(input.revision.packageData, input.revision.packageKey);
  const materializedPath = await ensureManagedExtensionMaterialized({
    home: input.home,
    tenantId: input.tenantId,
    stateMode: input.stateMode,
    kind: "mcp",
    revision: input.revision,
  });
  return {
    kind: "mcp",
    key: pkg.key,
    name: pkg.spec.name,
    description: null,
    version: null,
    enabled: input.revision.enabled,
    revision: input.revision.revision,
    source: sourceDescriptorForMcp(pkg.source),
    source_type: sourceType,
    refreshable: pkg.source.kind === "direct-url" || pkg.source.kind === "npm",
    materialized_path: materializedPath ?? null,
    assignment_count: input.assignmentCount,
    transport: pkg.spec.transport,
    default_access: "inherit",
    can_edit_settings: true,
    can_toggle_source_enabled: true,
    can_refresh_source: pkg.source.kind === "direct-url" || pkg.source.kind === "npm",
    can_revert_source: true,
  };
}

export async function buildExtensionDetail(input: {
  tenantId: string;
  stateMode: ExtensionStateMode;
  home: string;
  kind: ExtensionKind;
  revision: RuntimePackageRevision;
  assignmentCount: number;
  runtimePackageDal: RuntimePackageDal;
}): Promise<ManagedExtensionDetail> {
  const summary = await buildExtensionSummary(input);
  const revisions = await input.runtimePackageDal.listRevisions({
    tenantId: input.tenantId,
    packageKind: input.kind,
    packageKey: input.revision.packageKey,
  });

  if (input.kind === "skill") {
    const pkg = parseManagedSkillPackage(input.revision.packageData, input.revision.packageKey);
    return {
      ...summary,
      manifest: pkg.manifest,
      spec: null,
      files: pkg.files.map((file) => file.path),
      revisions: revisions.map((revision) => ({
        revision: revision.revision,
        enabled: revision.enabled,
        created_at: revision.createdAt,
        reason: revision.reason ?? null,
        reverted_from_revision: revision.revertedFromRevision ?? null,
      })),
      default_mcp_server_settings_json: null,
      default_mcp_server_settings_yaml: null,
      sources: [
        {
          source_type: summary.source_type,
          is_effective: true,
          enabled: summary.enabled,
          revision: summary.revision,
          refreshable: summary.refreshable,
          materialized_path: summary.materialized_path,
          transport: summary.transport,
          version: summary.version,
          description: summary.description,
          source: summary.source,
        },
      ],
    };
  }

  const pkg = parseManagedMcpPackage(input.revision.packageData, input.revision.packageKey);
  return {
    ...summary,
    manifest: null,
    spec: pkg.spec,
    files: pkg.files.map((file) => file.path),
    revisions: revisions.map((revision) => ({
      revision: revision.revision,
      enabled: revision.enabled,
      created_at: revision.createdAt,
      reason: revision.reason ?? null,
      reverted_from_revision: revision.revertedFromRevision ?? null,
    })),
    default_mcp_server_settings_json: null,
    default_mcp_server_settings_yaml: null,
    sources: [
      {
        source_type: summary.source_type,
        is_effective: true,
        enabled: summary.enabled,
        revision: summary.revision,
        refreshable: summary.refreshable,
        materialized_path: summary.materialized_path,
        transport: summary.transport,
        version: summary.version,
        description: summary.description,
        source: summary.source,
      },
    ],
  };
}
