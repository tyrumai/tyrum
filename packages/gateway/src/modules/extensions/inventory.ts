import { stringify as stringifyYaml } from "yaml";
import type {
  AgentConfig as AgentConfigT,
  ExtensionAccessDefault as ExtensionAccessDefaultT,
  ExtensionDiscoveredSource as ExtensionDiscoveredSourceT,
  ExtensionKind as ExtensionKindT,
  ManagedExtensionDetail as ManagedExtensionDetailT,
  ManagedExtensionRevision as ManagedExtensionRevisionT,
  ManagedExtensionSourceDescriptor as ManagedExtensionSourceDescriptorT,
  McpServerSpec as McpServerSpecT,
  SkillManifest as SkillManifestT,
} from "@tyrum/schemas";
import { AgentConfig, type ExtensionKind } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import { listMcpServersFromDir, listSkillsFromDir } from "../agent/workspace.js";
import { resolveBundledSkillsDir, resolveMcpDir, resolveUserSkillsDir } from "../agent/home.js";
import {
  ensureManagedExtensionMaterialized,
  parseManagedMcpPackage,
  parseManagedSkillPackage,
} from "./managed.js";
import type { ExtensionStateMode } from "./service.js";
import { RuntimePackageDal, type RuntimePackageRevision } from "../agent/runtime-package-dal.js";
import {
  ExtensionDefaultsDal,
  applyExtensionDefaultsToConfig,
  type ExtensionDefaultRecord,
} from "./defaults-dal.js";
import { buildBuiltinMemoryServerSpec } from "../memory/builtin-mcp.js";

type SourceType = ExtensionDiscoveredSourceT["source_type"];

type InventoryEntry = {
  kind: ExtensionKindT;
  key: string;
  name: string;
  description: string | null;
  version: string | null;
  transport: "stdio" | "remote" | null;
  enabled: boolean;
  revision: number | null;
  source: ManagedExtensionSourceDescriptorT | null;
  sourceType: SourceType;
  refreshable: boolean;
  materializedPath: string | null;
  manifest: SkillManifestT | null;
  spec: McpServerSpecT | null;
  files: string[];
  revisions: ManagedExtensionRevisionT[];
};

function priorityForSource(
  kind: ExtensionKindT,
  stateMode: ExtensionStateMode,
  source: SourceType,
): number {
  if (kind === "skill") {
    if (stateMode === "shared") {
      if (source === "shared") return 0;
      if (source === "bundled") return 1;
      return 2;
    }
    if (source === "managed") return 0;
    if (source === "user") return 1;
    if (source === "bundled") return 2;
    return 3;
  }

  if (source === "builtin") return 0;
  if (stateMode === "shared") {
    if (source === "shared") return 1;
    return 2;
  }
  if (source === "local") return 1;
  if (source === "managed") return 2;
  return 3;
}

function pickEffectiveEntry(
  kind: ExtensionKindT,
  stateMode: ExtensionStateMode,
  entries: readonly InventoryEntry[],
): InventoryEntry {
  const sortEntries = (items: readonly InventoryEntry[]) =>
    [...items].toSorted((left, right) => {
      const sourceOrder =
        priorityForSource(kind, stateMode, left.sourceType) -
        priorityForSource(kind, stateMode, right.sourceType);
      if (sourceOrder !== 0) return sourceOrder;
      return left.key.localeCompare(right.key);
    });

  const enabledEntries = sortEntries(entries.filter((entry) => entry.enabled));
  return enabledEntries[0] ?? sortEntries(entries)[0]!;
}

function toDiscoveredSource(
  effective: InventoryEntry,
  entry: InventoryEntry,
): ExtensionDiscoveredSourceT {
  return {
    source_type: entry.sourceType,
    is_effective: effective === entry,
    enabled: entry.enabled,
    revision: entry.revision,
    refreshable: entry.refreshable,
    materialized_path: entry.materializedPath,
    transport: entry.transport,
    version: entry.version,
    description: entry.description,
    source: entry.source,
  };
}

function defaultAccessForKey(
  defaultsByKey: ReadonlyMap<string, ExtensionDefaultRecord>,
  key: string,
): ExtensionAccessDefaultT {
  const value = defaultsByKey.get(key)?.defaultAccess;
  return value ?? "inherit";
}

function countAssignmentsWithDefaults(
  configs: readonly AgentConfigT[],
  defaults: readonly ExtensionDefaultRecord[],
  kind: ExtensionKindT,
  key: string,
): number {
  return configs.filter((config) => {
    const effective = applyExtensionDefaultsToConfig(config, defaults);
    const access = kind === "skill" ? effective.skills : effective.mcp;
    if (access.allow.includes(key)) return true;
    if (access.deny.includes(key)) return false;
    return access.default_mode === "allow";
  }).length;
}

async function listLatestAgentConfigs(db: SqlDb, tenantId: string) {
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
    } catch {
      // Intentional: malformed historical agent configs are skipped during inventory reads.
      return [];
    }
  });
}

async function buildManagedSkillEntry(input: {
  home: string;
  tenantId: string;
  stateMode: ExtensionStateMode;
  revision: RuntimePackageRevision;
}): Promise<InventoryEntry> {
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
    transport: null,
    enabled: input.revision.enabled,
    revision: input.revision.revision,
    source:
      pkg.source.kind === "direct-url"
        ? {
            kind: "direct-url",
            url: pkg.source.url,
            filename: pkg.source.filename ?? null,
          }
        : {
            kind: "upload",
            filename: pkg.source.filename ?? null,
          },
    sourceType: input.stateMode === "shared" ? "shared" : "managed",
    refreshable: pkg.source.kind === "direct-url",
    materializedPath: materializedPath ?? null,
    manifest: pkg.manifest,
    spec: null,
    files: pkg.files.map((file) => file.path),
    revisions: [],
  };
}

async function buildManagedMcpEntry(input: {
  home: string;
  tenantId: string;
  stateMode: ExtensionStateMode;
  revision: RuntimePackageRevision;
}): Promise<InventoryEntry> {
  const pkg = parseManagedMcpPackage(input.revision.packageData, input.revision.packageKey);
  const materializedPath = await ensureManagedExtensionMaterialized({
    home: input.home,
    tenantId: input.tenantId,
    stateMode: input.stateMode,
    kind: "mcp",
    revision: input.revision,
  });
  const source =
    pkg.source.kind === "direct-url"
      ? {
          kind: "direct-url" as const,
          url: pkg.source.url,
          mode: pkg.source.mode,
          filename: pkg.source.filename ?? null,
        }
      : pkg.source.kind === "npm"
        ? {
            kind: "npm" as const,
            npm_spec: pkg.source.npm_spec,
            command: pkg.source.command,
            args: pkg.source.args,
          }
        : {
            kind: "upload" as const,
            filename: pkg.source.filename ?? null,
          };
  return {
    kind: "mcp",
    key: pkg.key,
    name: pkg.spec.name,
    description: null,
    version: null,
    transport: pkg.spec.transport,
    enabled: input.revision.enabled,
    revision: input.revision.revision,
    source,
    sourceType: input.stateMode === "shared" ? "shared" : "managed",
    refreshable: pkg.source.kind === "direct-url" || pkg.source.kind === "npm",
    materializedPath: materializedPath ?? null,
    manifest: null,
    spec: pkg.spec,
    files: pkg.files.map((file) => file.path),
    revisions: [],
  };
}

async function loadSkillEntries(
  stateMode: ExtensionStateMode,
  keyFilter?: string,
): Promise<InventoryEntry[]> {
  const normalizedKey = keyFilter?.trim();
  const bundled = await listSkillsFromDir(resolveBundledSkillsDir(), "bundled");
  const bundledEntries: InventoryEntry[] = bundled.map((skill) => ({
    kind: "skill",
    key: skill.meta.id,
    name: skill.meta.name,
    description: skill.meta.description ?? null,
    version: skill.meta.version ?? null,
    transport: null,
    enabled: true,
    revision: null,
    source: null,
    sourceType: "bundled",
    refreshable: false,
    materializedPath: skill.provenance.path,
    manifest: skill,
    spec: null,
    files: ["SKILL.md"],
    revisions: [],
  }));
  const filteredBundledEntries = normalizedKey
    ? bundledEntries.filter((entry) => entry.key === normalizedKey)
    : bundledEntries;
  if (stateMode === "shared") {
    return filteredBundledEntries;
  }

  const userSkills = await listSkillsFromDir(resolveUserSkillsDir(), "user");
  const userEntries = userSkills.map((skill) => ({
    kind: "skill" as const,
    key: skill.meta.id,
    name: skill.meta.name,
    description: skill.meta.description ?? null,
    version: skill.meta.version ?? null,
    transport: null,
    enabled: true,
    revision: null,
    source: null,
    sourceType: "user" as const,
    refreshable: false,
    materializedPath: skill.provenance.path,
    manifest: skill,
    spec: null,
    files: ["SKILL.md"],
    revisions: [],
  }));
  const filteredUserEntries = normalizedKey
    ? userEntries.filter((entry) => entry.key === normalizedKey)
    : userEntries;
  return [...filteredBundledEntries, ...filteredUserEntries];
}

async function loadMcpEntries(
  home: string,
  stateMode: ExtensionStateMode,
  keyFilter?: string,
): Promise<InventoryEntry[]> {
  const normalizedKey = keyFilter?.trim();
  const builtin = buildBuiltinMemoryServerSpec();
  const entries: InventoryEntry[] = [
    {
      kind: "mcp",
      key: builtin.id,
      name: builtin.name,
      description: null,
      version: null,
      transport: builtin.transport,
      enabled: builtin.enabled,
      revision: null,
      source: null,
      sourceType: "builtin",
      refreshable: false,
      materializedPath: null,
      manifest: null,
      spec: builtin,
      files: [],
      revisions: [],
    },
  ];
  const filteredEntries = normalizedKey
    ? entries.filter((entry) => entry.key === normalizedKey)
    : entries;
  if (stateMode === "local") {
    const local = await listMcpServersFromDir(resolveMcpDir(home));
    const localEntries = local.map((server) => ({
      kind: "mcp" as const,
      key: server.id,
      name: server.name,
      description: null,
      version: null,
      transport: server.transport,
      enabled: server.enabled,
      revision: null,
      source: null,
      sourceType: "local" as const,
      refreshable: false,
      materializedPath: server.transport === "stdio" ? (server.cwd ?? null) : null,
      manifest: null,
      spec: server,
      files: [],
      revisions: [],
    }));
    return normalizedKey
      ? [...filteredEntries, ...localEntries.filter((entry) => entry.key === normalizedKey)]
      : [...filteredEntries, ...localEntries];
  }
  return filteredEntries;
}

export async function buildExtensionInventory(params: {
  db: SqlDb;
  tenantId: string;
  kind: ExtensionKind;
  stateMode: ExtensionStateMode;
  home: string;
  key?: string;
}): Promise<ManagedExtensionDetailT[]> {
  const runtimePackageDal = new RuntimePackageDal(params.db);
  const defaultsDal = new ExtensionDefaultsDal(params.db);
  const normalizedKey = params.key?.trim();
  const [rawConfigs, defaults, skillEntries, mcpEntries, managedRevisions] = await Promise.all([
    listLatestAgentConfigs(params.db, params.tenantId),
    defaultsDal.list(params.tenantId, params.kind),
    params.kind === "skill"
      ? loadSkillEntries(params.stateMode, normalizedKey)
      : Promise.resolve([]),
    params.kind === "mcp"
      ? loadMcpEntries(params.home, params.stateMode, normalizedKey)
      : Promise.resolve([]),
    runtimePackageDal.listLatest({
      tenantId: params.tenantId,
      packageKind: params.kind,
      ...(normalizedKey ? { packageKeys: [normalizedKey] } : {}),
    }),
  ]);

  const revisionsByKey = new Map<string, ManagedExtensionRevisionT[]>();
  await Promise.all(
    managedRevisions.map(async (revision) => {
      const revisions = await runtimePackageDal.listRevisions({
        tenantId: params.tenantId,
        packageKind: params.kind,
        packageKey: revision.packageKey,
      });
      revisionsByKey.set(
        revision.packageKey,
        revisions.map((item) => ({
          revision: item.revision,
          enabled: item.enabled,
          created_at: item.createdAt,
          reason: item.reason ?? null,
          reverted_from_revision: item.revertedFromRevision ?? null,
        })),
      );
    }),
  );

  const managedEntries = await Promise.all(
    managedRevisions.map(async (revision) => {
      const entry =
        params.kind === "skill"
          ? await buildManagedSkillEntry({
              home: params.home,
              tenantId: params.tenantId,
              stateMode: params.stateMode,
              revision,
            })
          : await buildManagedMcpEntry({
              home: params.home,
              tenantId: params.tenantId,
              stateMode: params.stateMode,
              revision,
            });
      entry.revisions = revisionsByKey.get(revision.packageKey) ?? [];
      return entry;
    }),
  );

  const discovered = [...skillEntries, ...mcpEntries, ...managedEntries];
  const byKey = new Map<string, InventoryEntry[]>();
  for (const item of discovered) {
    if (item.kind !== params.kind) continue;
    const existing = byKey.get(item.key) ?? [];
    existing.push(item);
    byKey.set(item.key, existing);
  }

  const defaultsByKey = new Map(defaults.map((item) => [item.extensionId, item]));
  const items: ManagedExtensionDetailT[] = [];
  for (const [key, entries] of [...byKey.entries()].toSorted(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const effective = pickEffectiveEntry(params.kind, params.stateMode, entries);
    const sources = entries
      .toSorted(
        (left, right) =>
          priorityForSource(params.kind, params.stateMode, left.sourceType) -
          priorityForSource(params.kind, params.stateMode, right.sourceType),
      )
      .map((entry) => toDiscoveredSource(effective, entry));
    const overlay = defaultsByKey.get(key);
    const defaultSettingsJson = params.kind === "mcp" ? (overlay?.settings ?? null) : null;
    items.push({
      kind: params.kind,
      key,
      name: effective.name,
      description: effective.description,
      version: effective.version,
      enabled: effective.enabled,
      revision: effective.revision,
      source: effective.source,
      source_type: effective.sourceType,
      refreshable: effective.refreshable,
      materialized_path: effective.materializedPath,
      assignment_count: countAssignmentsWithDefaults(rawConfigs, defaults, params.kind, key),
      transport: effective.transport,
      default_access: defaultAccessForKey(defaultsByKey, key),
      can_edit_settings: params.kind === "mcp",
      can_toggle_source_enabled:
        effective.sourceType === "managed" || effective.sourceType === "shared",
      can_refresh_source:
        (effective.sourceType === "managed" || effective.sourceType === "shared") &&
        effective.refreshable,
      can_revert_source: effective.sourceType === "managed" || effective.sourceType === "shared",
      manifest: effective.manifest,
      spec: effective.spec,
      files: effective.files,
      revisions: effective.revisions,
      default_mcp_server_settings_json: defaultSettingsJson,
      default_mcp_server_settings_yaml:
        defaultSettingsJson && params.kind === "mcp" ? stringifyYaml(defaultSettingsJson) : null,
      sources,
    });
  }

  return items;
}
