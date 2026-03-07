import {
  PluginManifest,
  type PluginManifest as PluginManifestT,
  type WsEventEnvelope,
} from "@tyrum/schemas";
import type { ErrorObject } from "ajv";
import { Ajv2019 } from "ajv/dist/2019.js";
import type { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { type Dirent } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import type { GatewayContainer } from "../../container.js";
import { isRecord, parseJsonOrYaml } from "../../utils/parse-json-or-yaml.js";
import { OPERATOR_WS_AUDIENCE } from "../../ws/audience.js";
import { enqueueWsBroadcastMessage } from "../../ws/outbox.js";
import type { ToolDescriptor } from "../agent/tools.js";
import { DEFAULT_TENANT_ID } from "../identity/scope.js";
import type { Logger } from "../observability/logger.js";
import {
  parsePluginLockFile,
  pluginIntegritySha256Hex,
  PLUGIN_LOCK_FILENAME,
  type PluginInstallInfo,
} from "./lockfile.js";
import {
  type PluginDir,
  type PluginDirKind,
  resolvePluginSearchDirs,
} from "./directories.js";
import { missingRequiredManifestFields, resolveSafeChildPath } from "./validation.js";

const PLUGIN_LIFECYCLE_AUDIT_PLAN_ID = "gateway.plugins.lifecycle";
const PLUGIN_TOOL_INVOKED_AUDIT_PLAN_PREFIX = "gateway.plugins.tool_invoked";
const MANIFEST_CANDIDATES = ["plugin.yml", "plugin.yaml", "plugin.json"] as const;
const CONFIG_CANDIDATES = ["config.yml", "config.yaml", "config.json"] as const;
const JSON_SCHEMA_CHILD_KEYS = new Set([
  "items",
  "contains",
  "not",
  "if",
  "then",
  "else",
  "propertyNames",
  "unevaluatedItems",
  "additionalItems",
]);
const JSON_SCHEMA_ARRAY_KEYS = new Set(["prefixItems", "anyOf", "oneOf"]);
const JSON_SCHEMA_RECORD_KEYS = new Set([
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
]);

export type PluginCommandExecuteResult = { output: string; data?: unknown };
export type PluginToolExecuteResult = { output: string; error?: string };
export interface PluginToolContext {
  home: string;
  agent_id: string;
  workspace_id: string;
  logger: Logger;
  fetch: typeof fetch;
  container?: GatewayContainer;
}
export interface PluginCommandContext {
  logger: Logger;
  container?: GatewayContainer;
}
export type PluginToolRegistration = {
  descriptor: ToolDescriptor;
  execute: (args: unknown, ctx: PluginToolContext) => Promise<PluginToolExecuteResult>;
};
export type PluginCommandRegistration = {
  name: string;
  execute: (args: string[], ctx: PluginCommandContext) => Promise<PluginCommandExecuteResult>;
};
export type PluginRegistration = {
  tools?: PluginToolRegistration[];
  commands?: PluginCommandRegistration[];
  router?: Hono;
};
export type PluginRegisterFn = (ctx: {
  manifest: PluginManifestT;
  config: unknown;
  logger: Logger;
}) => PluginRegistration | Promise<PluginRegistration>;

type LoadedPlugin = {
  manifest: PluginManifestT;
  source_dir: string;
  install?: PluginInstallInfo;
  entry_path: string;
  tools: Map<string, PluginToolRegistration>;
  commands: Map<string, PluginCommandRegistration>;
  router?: Hono;
  loaded_at: string;
};
type NormalizeSchemaOptions = {
  root?: unknown;
  skipAdditionalPropertiesDefault?: boolean;
  skipAdditionalPropertiesDefaultFor?: WeakSet<object>;
};

const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const isJsonSchemaObject = (value: unknown): value is Record<string, unknown> => isRecord(value);
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
const errorCode = (err: unknown) =>
  err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : undefined;
const hasSchemaProperties = (value: object) =>
  hasOwn(value, "properties") || hasOwn(value, "patternProperties");
const normalizePluginId = (id: string) => id.trim() || "plugin";
const toolIdAllowed = (manifest: PluginManifestT, toolId: string) =>
  Boolean(manifest.contributes?.tools?.includes(toolId));
const commandAllowed = (manifest: PluginManifestT, name: string) =>
  Boolean(manifest.contributes?.commands?.includes(name));
const cloneManifest = (manifest: PluginManifestT) => structuredClone(manifest) as PluginManifestT;
const isTrustedOwner = (uid: number, currentUid: number) => uid === currentUid || uid === 0;
const isWorldWritable = (mode: number) => (mode & 0o002) !== 0;
const selectContainerForPlugin = (manifest: PluginManifestT, container?: GatewayContainer) =>
  container && manifest.permissions?.db ? container : undefined;
const getCurrentUid = () => {
  if (typeof process.getuid !== "function") return undefined;
  try {
    return process.getuid();
  } catch {
    // Intentional: environments without a stable uid are treated as unknown ownership.
    return undefined;
  }
};
const unescapeJsonPointerSegment = (value: string) =>
  value.replace(/~[01]/g, (match) => (match === "~1" ? "/" : "~"));

function looksLikeJsonSchemaObjectShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const type = value["type"];
  return (
    type === "object" ||
    (Array.isArray(type) && type.includes("object")) ||
    hasSchemaProperties(value)
  );
}

function resolveInternalJsonSchemaRef(root: unknown, ref: string): unknown | undefined {
  if (ref === "#") return root;
  if (!ref.startsWith("#/")) return undefined;
  let current: unknown = root;
  for (const part of ref.slice(2).split("/").map(unescapeJsonPointerSegment)) {
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
      current = current[index];
      continue;
    }
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function looksLikeJsonSchemaObjectShapeOrRef(
  value: unknown,
  root: unknown,
  seenRefs = new Set<string>(),
): boolean {
  if (looksLikeJsonSchemaObjectShape(value)) return true;
  if (!isRecord(value)) return false;
  const ref = value["$ref"];
  if (typeof ref !== "string" || seenRefs.has(ref)) return false;
  seenRefs.add(ref);
  const resolved = resolveInternalJsonSchemaRef(root, ref);
  return resolved ? looksLikeJsonSchemaObjectShapeOrRef(resolved, root, seenRefs) : false;
}

function collectAllOfInternalRefTargets(root: unknown): WeakSet<object> {
  const targets = new WeakSet<object>(),
    visited = new WeakSet<object>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object" || visited.has(node)) return;
    visited.add(node);
    if (Array.isArray(node)) return void node.forEach(visit);
    const record = node as Record<string, unknown>,
      allOf = record["allOf"],
      ref = record["$ref"];
    if (Array.isArray(allOf)) {
      for (const entry of allOf) {
        if (!isRecord(entry) || typeof entry["$ref"] !== "string") continue;
        const resolved = resolveInternalJsonSchemaRef(root, entry["$ref"]);
        if (resolved && typeof resolved === "object") targets.add(resolved as object);
      }
    }
    if (
      typeof ref === "string" &&
      !(Array.isArray(allOf) && allOf.length > 0) &&
      hasSchemaProperties(record) &&
      !hasOwn(record, "additionalProperties") &&
      !hasOwn(record, "unevaluatedProperties") &&
      looksLikeJsonSchemaObjectShapeOrRef(record, root)
    ) {
      const resolved = resolveInternalJsonSchemaRef(root, ref);
      if (resolved && typeof resolved === "object") targets.add(resolved as object);
    }
    Object.values(record).forEach(visit);
  };
  visit(root);
  return targets;
}

function normalizeJsonSchemaAdditionalPropertiesDefaults(
  schema: unknown,
  seen = new WeakMap<object, unknown>(),
  opts?: NormalizeSchemaOptions,
): unknown {
  if (!schema || typeof schema !== "object") return schema;
  const existing = seen.get(schema);
  if (existing) return existing;
  const childOpts = opts ? { ...opts, skipAdditionalPropertiesDefault: false } : undefined;
  if (Array.isArray(schema)) {
    const out = schema.map((item) =>
      normalizeJsonSchemaAdditionalPropertiesDefaults(item, seen, childOpts),
    );
    seen.set(schema, out);
    return out;
  }
  const record = schema as Record<string, unknown>,
    out = Object.create(null) as Record<string, unknown>;
  seen.set(schema, out);
  const allOf = record["allOf"],
    hasAllOf = Array.isArray(allOf) && allOf.length > 0,
    root = opts?.root;
  const skipAdditionalPropertiesDefault = Boolean(
    opts?.skipAdditionalPropertiesDefault || opts?.skipAdditionalPropertiesDefaultFor?.has(schema),
  );
  const additionalPropertiesExplicit = hasOwn(record, "additionalProperties"),
    unevaluatedPropertiesExplicit = hasOwn(record, "unevaluatedProperties");
  const isObjectSchema = looksLikeJsonSchemaObjectShape(record);
  const looksLikeAllOfObjectSchema =
    hasAllOf &&
    (isObjectSchema ||
      (root
        ? (allOf as unknown[]).some((entry) => looksLikeJsonSchemaObjectShapeOrRef(entry, root))
        : (allOf as unknown[]).some(looksLikeJsonSchemaObjectShape)));
  for (const [key, value] of Object.entries(record)) {
    if (key === "additionalProperties" || key === "unevaluatedProperties") {
      out[key] =
        typeof value === "boolean"
          ? value
          : normalizeJsonSchemaAdditionalPropertiesDefaults(value, seen, childOpts);
      continue;
    }
    if (JSON_SCHEMA_CHILD_KEYS.has(key)) {
      out[key] = normalizeJsonSchemaAdditionalPropertiesDefaults(value, seen, childOpts);
      continue;
    }
    if (JSON_SCHEMA_ARRAY_KEYS.has(key)) {
      out[key] = Array.isArray(value)
        ? value.map((entry) =>
            normalizeJsonSchemaAdditionalPropertiesDefaults(entry, seen, childOpts),
          )
        : value;
      continue;
    }
    if (key === "allOf") {
      out[key] = Array.isArray(value)
        ? value.map((entry) =>
            normalizeJsonSchemaAdditionalPropertiesDefaults(entry, seen, {
              ...opts,
              skipAdditionalPropertiesDefault: true,
            }),
          )
        : value;
      continue;
    }
    if (JSON_SCHEMA_RECORD_KEYS.has(key)) {
      out[key] = isRecord(value)
        ? Object.fromEntries(
            Object.entries(value).map(([prop, schemaValue]) => [
              prop,
              normalizeJsonSchemaAdditionalPropertiesDefaults(schemaValue, seen, childOpts),
            ]),
          )
        : value;
      continue;
    }
    out[key] = value;
  }
  if (
    !skipAdditionalPropertiesDefault &&
    !additionalPropertiesExplicit &&
    !unevaluatedPropertiesExplicit
  ) {
    if (looksLikeAllOfObjectSchema) out["unevaluatedProperties"] = false;
    else if (isObjectSchema) out["additionalProperties"] = false;
  }
  const ref = record["$ref"];
  if (
    typeof ref === "string" &&
    !skipAdditionalPropertiesDefault &&
    !additionalPropertiesExplicit &&
    !unevaluatedPropertiesExplicit &&
    !hasAllOf &&
    root &&
    looksLikeJsonSchemaObjectShapeOrRef(record, root)
  ) {
    delete out["additionalProperties"];
    delete out["$ref"];
    out["allOf"] = [{ $ref: ref }];
    out["unevaluatedProperties"] = false;
  }
  return out;
}

async function tryReadFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    // Intentional: missing manifest candidates are skipped during plugin discovery.
    return undefined;
  }
}

async function loadManifestFromDir(
  dir: string,
): Promise<{ path: string; raw: string; manifest: PluginManifestT } | undefined> {
  for (const filename of MANIFEST_CANDIDATES) {
    const path = join(dir, filename),
      raw = await tryReadFile(path);
    if (!raw) continue;
    const parsed = parseJsonOrYaml(raw, path);
    if (!isRecord(parsed)) throw new Error("manifest must be an object");
    const missingFields = missingRequiredManifestFields(parsed);
    if (missingFields.length > 0)
      throw new Error(`missing required manifest field(s): ${missingFields.join(", ")}`);
    return { path, raw, manifest: PluginManifest.parse(parsed) };
  }
  return undefined;
}

async function loadConfigFromDir(dir: string): Promise<{ path?: string; config: unknown }> {
  for (const filename of CONFIG_CANDIDATES) {
    const path = join(dir, filename),
      raw = await tryReadFile(path);
    if (raw === undefined) continue;
    try {
      return { path, config: parseJsonOrYaml(raw, path) };
    } catch (err) {
      throw new Error(`failed to parse config (${filename}): ${errorMessage(err)}`);
    }
  }
  return { config: {} };
}

function validatePluginConfig(params: {
  schema: unknown;
  config: unknown;
}):
  | { ok: true; normalizedSchema: Record<string, unknown>; config: unknown }
  | { ok: false; error: string } {
  const normalizedSchema = normalizeJsonSchemaAdditionalPropertiesDefaults(
    params.schema,
    new WeakMap<object, unknown>(),
    {
      root: params.schema,
      skipAdditionalPropertiesDefaultFor: collectAllOfInternalRefTargets(params.schema),
    },
  );
  if (!isJsonSchemaObject(normalizedSchema))
    return { ok: false, error: "config_schema must be a JSON Schema object" };
  try {
    const validate = new Ajv2019({ allErrors: true, strict: false, unevaluated: true }).compile(
      normalizedSchema,
    );
    if (validate(params.config)) return { ok: true, normalizedSchema, config: params.config };
    const errors = ((validate.errors ?? []) as ErrorObject[])
      .map(
        (err) =>
          `${err.instancePath && err.instancePath.length > 0 ? err.instancePath : "/"}: ${err.message ? String(err.message) : "invalid"}`,
      )
      .filter(Boolean);
    return {
      ok: false,
      error: errors.length > 0 ? errors.join("; ") : "config does not match schema",
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

function isWithinDir(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!isAbsolute(rel) && rel.split(/[\\/]/g)[0] !== "..");
}

async function resolveSecureDir(params: {
  logger: Logger;
  event: "plugins.insecure_root_dir" | "plugins.insecure_plugin_dir";
  kind: PluginDirKind;
  path: string;
  currentUid?: number;
  rootDir?: string;
  rootRealDir?: string;
}): Promise<string | undefined> {
  const dirKey = params.rootRealDir ? "source_dir" : "root_dir";
  let realDir: string;
  try {
    realDir = await realpath(params.path);
  } catch (err) {
    params.logger.warn(params.event, {
      [dirKey]: params.path,
      kind: params.kind,
      reason: "unresolvable",
      error: errorMessage(err),
    });
    return undefined;
  }
  if (params.rootRealDir && !isWithinDir(params.rootRealDir, realDir)) {
    params.logger.warn(params.event, {
      source_dir: params.path,
      kind: params.kind,
      reason: "escapes_root",
      root_dir: params.rootDir,
      root_real_dir: params.rootRealDir,
      plugin_real_dir: realDir,
    });
    return undefined;
  }
  if (params.currentUid === undefined) return realDir;
  try {
    const dirStat = await stat(realDir);
    if (isWorldWritable(dirStat.mode)) {
      params.logger.warn(params.event, {
        [dirKey]: params.path,
        kind: params.kind,
        reason: "world_writable",
        mode: dirStat.mode,
      });
      return undefined;
    }
    if (!isTrustedOwner(dirStat.uid, params.currentUid)) {
      params.logger.warn(params.event, {
        [dirKey]: params.path,
        kind: params.kind,
        reason: "unsafe_ownership",
        uid: dirStat.uid,
        current_uid: params.currentUid,
      });
      return undefined;
    }
  } catch (err) {
    params.logger.warn(params.event, {
      [dirKey]: params.path,
      kind: params.kind,
      reason: "unstatable",
      error: errorMessage(err),
    });
    return undefined;
  }
  return realDir;
}

async function loadPluginLock(params: {
  logger: Logger;
  pluginId: string;
  pluginDir: string;
  manifestVersion: string;
}): Promise<PluginInstallInfo | undefined | null> {
  let lockRaw: string;
  try {
    lockRaw = await readFile(join(params.pluginDir, PLUGIN_LOCK_FILENAME), "utf-8");
  } catch (err) {
    if (errorCode(err) === "ENOENT") return undefined;
    params.logger.warn("plugins.lock_unreadable", {
      plugin_id: params.pluginId,
      source_dir: params.pluginDir,
      error: errorMessage(err),
    });
    return null;
  }
  const parsedLock = parsePluginLockFile(lockRaw);
  if (!parsedLock) {
    params.logger.warn("plugins.lock_invalid", {
      plugin_id: params.pluginId,
      source_dir: params.pluginDir,
    });
    return null;
  }
  if (parsedLock.pinned_version !== params.manifestVersion) {
    params.logger.warn("plugins.lock_version_mismatch", {
      plugin_id: params.pluginId,
      source_dir: params.pluginDir,
      pinned_version: parsedLock.pinned_version,
      manifest_version: params.manifestVersion,
    });
    return null;
  }
  return parsedLock;
}

async function resolvePluginEntryPath(params: {
  logger: Logger;
  pluginId: string;
  pluginDir: string;
  pluginRealDir: string;
  entry: string;
}): Promise<string | undefined> {
  let entryPath: string;
  try {
    entryPath = resolveSafeChildPath(params.pluginDir, params.entry);
  } catch (err) {
    params.logger.warn("plugins.invalid_entry_path", {
      plugin_id: params.pluginId,
      source_dir: params.pluginDir,
      entry: params.entry,
      error: errorMessage(err),
    });
    return undefined;
  }
  try {
    const entryRealPath = await realpath(entryPath);
    if (!isWithinDir(params.pluginRealDir, entryRealPath)) {
      params.logger.warn("plugins.invalid_entry_path", {
        plugin_id: params.pluginId,
        source_dir: params.pluginDir,
        entry: params.entry,
        reason: "symlink_escape",
        entry_path: entryPath,
        entry_real_path: entryRealPath,
        plugin_real_dir: params.pluginRealDir,
      });
      return undefined;
    }
    return entryRealPath;
  } catch (err) {
    params.logger.warn("plugins.import_failed", {
      plugin_id: params.pluginId,
      source_dir: params.pluginDir,
      entry_path: entryPath,
      error: errorMessage(err),
    });
    return undefined;
  }
}

async function verifyPluginIntegrity(params: {
  logger: Logger;
  pluginId: string;
  pluginDir: string;
  manifestRaw: string;
  entryPath: string;
  install?: PluginInstallInfo;
}): Promise<boolean> {
  if (!params.install) return true;
  const entryRaw = await tryReadFile(params.entryPath);
  if (entryRaw === undefined) {
    params.logger.warn("plugins.lock_integrity_mismatch", {
      plugin_id: params.pluginId,
      source_dir: params.pluginDir,
      reason: "entry_unreadable",
    });
    return false;
  }
  const integritySha256 = pluginIntegritySha256Hex(params.manifestRaw, entryRaw);
  if (integritySha256 === params.install.integrity_sha256.toLowerCase()) return true;
  params.logger.warn("plugins.lock_integrity_mismatch", {
    plugin_id: params.pluginId,
    source_dir: params.pluginDir,
    pinned_version: params.install.pinned_version,
    expected_sha256: params.install.integrity_sha256,
    actual_sha256: integritySha256,
  });
  return false;
}

async function loadRegisterFn(params: {
  logger: Logger;
  pluginId: string;
  pluginDir: string;
  entryPath: string;
}): Promise<PluginRegisterFn | undefined> {
  try {
    const mod = (await import(pathToFileURL(params.entryPath).href)) as Record<string, unknown>,
      candidate = mod["registerPlugin"];
    return typeof candidate === "function" ? (candidate as PluginRegisterFn) : undefined;
  } catch (err) {
    params.logger.warn("plugins.import_failed", {
      plugin_id: params.pluginId,
      source_dir: params.pluginDir,
      entry_path: params.entryPath,
      error: errorMessage(err),
    });
    return undefined;
  }
}

function collectPluginRegistration(
  manifest: PluginManifestT,
  registration: PluginRegistration,
): {
  tools: Map<string, PluginToolRegistration>;
  commands: Map<string, PluginCommandRegistration>;
  undeclaredTools: string[];
  undeclaredCommands: string[];
  undeclaredRouter: boolean;
} {
  const tools = new Map<string, PluginToolRegistration>(),
    undeclaredTools: string[] = [];
  for (const tool of registration.tools ?? []) {
    const toolId = tool?.descriptor.id?.trim?.() ?? "";
    if (!tool?.descriptor || typeof tool.execute !== "function" || !toolId) continue;
    if (!toolIdAllowed(manifest, toolId)) undeclaredTools.push(toolId);
    else tools.set(toolId, tool);
  }
  const commands = new Map<string, PluginCommandRegistration>(),
    undeclaredCommands: string[] = [];
  for (const cmd of registration.commands ?? []) {
    const name = typeof cmd?.name === "string" ? cmd.name.trim() : "";
    if (!name || typeof cmd?.execute !== "function") continue;
    if (!commandAllowed(manifest, name)) undeclaredCommands.push(name);
    else commands.set(name, cmd);
  }
  return {
    tools,
    commands,
    undeclaredTools,
    undeclaredCommands,
    undeclaredRouter:
      Boolean(registration.router) && (manifest.contributes?.routes?.length ?? 0) === 0,
  };
}

function parsePluginCommand(raw: string): { name: string; args: string[] } | undefined {
  const parts = raw.trim().replace(/^\//, "").trim().split(/\s+/g).filter(Boolean);
  return parts.length > 0 ? { name: parts[0]!, args: parts.slice(1) } : undefined;
}

export class PluginRegistry {
  private readonly plugins = new Map<string, LoadedPlugin>();

  constructor(
    private readonly opts: {
      logger: Logger;
      container?: GatewayContainer;
      fetchImpl?: typeof fetch;
    },
  ) {}

  static async load(opts: {
    home: string;
    userHome?: string;
    logger: Logger;
    container?: GatewayContainer;
    fetchImpl?: typeof fetch;
    includeWorkspacePlugins?: boolean;
    includeUserPlugins?: boolean;
    includeBundledPlugins?: boolean;
  }): Promise<PluginRegistry> {
    const registry = new PluginRegistry({
      logger: opts.logger,
      container: opts.container,
      fetchImpl: opts.fetchImpl,
    });
    const dirs = resolvePluginSearchDirs(opts);
    await registry.loadFromDirectories(dirs);
    return registry;
  }

  list(): Array<{
    id: string;
    name: string;
    version: string;
    contributions: PluginManifestT["contributes"] | undefined;
    permissions: PluginManifestT["permissions"] | undefined;
    install?: PluginInstallInfo;
    loaded_at: string;
    source_dir: string;
  }> {
    return [...this.plugins.values()]
      .map((plugin) => ({
        id: plugin.manifest.id,
        name: plugin.manifest.name,
        version: plugin.manifest.version,
        contributions: plugin.manifest.contributes,
        permissions: plugin.manifest.permissions,
        install: plugin.install ? structuredClone(plugin.install) : undefined,
        loaded_at: plugin.loaded_at,
        source_dir: plugin.source_dir,
      }))
      .toSorted((a, b) => a.id.localeCompare(b.id));
  }

  getManifest(pluginId: string): PluginManifestT | undefined {
    return this.plugins.get(normalizePluginId(pluginId))?.manifest;
  }
  getToolDescriptors(): ToolDescriptor[] {
    return [...this.plugins.values()].flatMap((plugin) =>
      [...plugin.tools.values()].map((tool) => tool.descriptor),
    );
  }

  getTool(toolId: string): { plugin: PluginManifestT; tool: PluginToolRegistration } | undefined {
    for (const plugin of this.plugins.values()) {
      const tool = plugin.tools.get(toolId);
      if (tool) return { plugin: plugin.manifest, tool };
    }
    return undefined;
  }

  async executeTool(params: {
    toolId: string;
    toolCallId: string;
    args: unknown;
    home: string;
    agentId: string;
    workspaceId: string;
    auditPlanId?: string;
    sessionId?: string;
    channel?: string;
    threadId?: string;
    policySnapshotId?: string;
  }): Promise<PluginToolExecuteResult | undefined> {
    const found = this.getTool(params.toolId);
    if (!found) return undefined;
    const startMs = Date.now();
    let result: PluginToolExecuteResult;
    try {
      result = await found.tool.execute(params.args, {
        home: params.home,
        agent_id: params.agentId,
        workspace_id: params.workspaceId,
        logger: this.opts.logger,
        fetch: this.opts.fetchImpl ?? fetch,
        container: selectContainerForPlugin(found.plugin, this.opts.container),
      });
    } catch (err) {
      result = { output: "", error: errorMessage(err) };
    }
    await this.emitPluginToolInvokedEvent({
      pluginId: found.plugin.id,
      pluginVersion: found.plugin.version,
      toolId: params.toolId,
      toolCallId: params.toolCallId,
      agentId: params.agentId,
      workspaceId: params.workspaceId,
      sessionId: params.sessionId,
      channel: params.channel,
      threadId: params.threadId,
      policySnapshotId: params.policySnapshotId,
      auditPlanId: params.auditPlanId,
      outcome: result.error ? "failed" : "succeeded",
      error: result.error,
      durationMs: Math.max(0, Date.now() - startMs),
    });
    return result;
  }

  async tryExecuteCommand(raw: string): Promise<PluginCommandExecuteResult | undefined> {
    const command = parsePluginCommand(raw);
    if (!command) return undefined;
    for (const plugin of this.plugins.values()) {
      const cmd = plugin.commands.get(command.name);
      if (!cmd) continue;
      try {
        return await cmd.execute(command.args, {
          logger: this.opts.logger,
          container: selectContainerForPlugin(plugin.manifest, this.opts.container),
        });
      } catch (err) {
        return { output: `Plugin command '${command.name}' failed: ${errorMessage(err)}` };
      }
    }
    return undefined;
  }

  routers(): Array<{ pluginId: string; router: Hono }> {
    return [...this.plugins.values()].flatMap((plugin) =>
      plugin.router ? [{ pluginId: plugin.manifest.id, router: plugin.router }] : [],
    );
  }

  private async loadFromDirectories(dirs: PluginDir[]): Promise<void> {
    for (const dir of dirs) await this.loadFromDirectory(dir);
  }

  private async loadFromDirectory(dir: PluginDir): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir.path, { withFileTypes: true });
    } catch {
      // Intentional: absent plugin directories are ignored during discovery.
      return;
    }
    const currentUid = getCurrentUid();
    const rootRealDir = await resolveSecureDir({
      logger: this.opts.logger,
      event: "plugins.insecure_root_dir",
      kind: dir.kind,
      path: dir.path,
      currentUid,
    });
    if (!rootRealDir) return;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pluginDir = join(dir.path, entry.name);
      const pluginRealDir = await resolveSecureDir({
        logger: this.opts.logger,
        event: "plugins.insecure_plugin_dir",
        kind: dir.kind,
        path: pluginDir,
        currentUid,
        rootDir: dir.path,
        rootRealDir,
      });
      if (pluginRealDir) await this.loadPluginFromDirectory(dir, pluginDir, pluginRealDir);
    }
  }

  private async loadPluginFromDirectory(
    dir: PluginDir,
    pluginDir: string,
    pluginRealDir: string,
  ): Promise<void> {
    let manifestFile: Awaited<ReturnType<typeof loadManifestFromDir>>;
    try {
      manifestFile = await loadManifestFromDir(pluginDir);
    } catch (err) {
      const error = errorMessage(err);
      this.opts.logger.warn("plugins.invalid_manifest", { source_dir: pluginDir, error });
      await this.emitPluginLifecycleEvent({
        kind: "failed",
        sourceKind: dir.kind,
        sourceDir: pluginDir,
        reason: "invalid_manifest",
        error,
      });
      return;
    }
    if (!manifestFile) return;
    const id = normalizePluginId(manifestFile.manifest.id);
    if (this.plugins.has(id)) return;
    const manifest = cloneManifest({ ...manifestFile.manifest, id });
    const failLifecycle = async (
      event: string,
      reason: string,
      extra: Record<string, unknown> = {},
      error?: string,
    ) => {
      this.opts.logger.warn(event, {
        plugin_id: id,
        source_dir: pluginDir,
        ...extra,
        ...(error ? { error } : {}),
      });
      await this.emitPluginLifecycleEvent({
        kind: "failed",
        plugin: manifest,
        sourceKind: dir.kind,
        sourceDir: pluginDir,
        reason,
        error,
      });
    };
    if (!manifest.entry)
      return void (await failLifecycle("plugins.missing_entry", "missing_entry"));
    const pluginInstall = await loadPluginLock({
      logger: this.opts.logger,
      pluginId: id,
      pluginDir,
      manifestVersion: manifest.version,
    });
    if (pluginInstall === null) return;
    let configPath: string | undefined, config: unknown;
    try {
      const loadedConfig = await loadConfigFromDir(pluginDir);
      configPath = loadedConfig.path;
      config = loadedConfig.config;
    } catch (err) {
      this.opts.logger.warn("plugins.invalid_config", {
        plugin_id: id,
        source_dir: pluginDir,
        error: errorMessage(err),
      });
      return;
    }
    const configValidation = validatePluginConfig({ schema: manifest.config_schema, config });
    if (!configValidation.ok)
      return void (await failLifecycle(
        "plugins.invalid_config",
        "invalid_config",
        { config_path: configPath },
        configValidation.error,
      ));
    manifest.config_schema = configValidation.normalizedSchema;
    const entryPath = await resolvePluginEntryPath({
      logger: this.opts.logger,
      pluginId: id,
      pluginDir,
      pluginRealDir,
      entry: manifest.entry,
    });
    if (
      !entryPath ||
      !(await verifyPluginIntegrity({
        logger: this.opts.logger,
        pluginId: id,
        pluginDir,
        manifestRaw: manifestFile.raw,
        entryPath,
        install: pluginInstall ?? undefined,
      }))
    )
      return;
    const registerFn = await loadRegisterFn({
      logger: this.opts.logger,
      pluginId: id,
      pluginDir,
      entryPath,
    });
    if (!registerFn) {
      this.opts.logger.warn("plugins.missing_register", {
        plugin_id: id,
        source_dir: pluginDir,
        entry_path: entryPath,
      });
      return;
    }
    let registration: PluginRegistration;
    try {
      registration = await Promise.resolve(
        registerFn({
          manifest: cloneManifest(manifest),
          config: configValidation.config,
          logger: this.opts.logger.child({ plugin_id: id }),
        }),
      );
    } catch (err) {
      this.opts.logger.warn("plugins.register_failed", {
        plugin_id: id,
        source_dir: pluginDir,
        error: errorMessage(err),
      });
      return;
    }
    const { tools, commands, undeclaredTools, undeclaredCommands, undeclaredRouter } =
      collectPluginRegistration(manifest, registration);
    if (undeclaredTools.length > 0 || undeclaredCommands.length > 0 || undeclaredRouter) {
      this.opts.logger.warn("plugins.undeclared_contributions", {
        plugin_id: id,
        source_dir: pluginDir,
        tools: undeclaredTools,
        commands: undeclaredCommands,
        router: undeclaredRouter,
      });
      return;
    }
    this.plugins.set(id, {
      manifest,
      source_dir: pluginDir,
      install: pluginInstall ? structuredClone(pluginInstall) : undefined,
      entry_path: entryPath,
      tools,
      commands,
      router: registration.router,
      loaded_at: new Date().toISOString(),
    });
    this.opts.logger.info("plugins.loaded", {
      plugin_id: id,
      source_dir: pluginDir,
      tools: tools.size,
      commands: commands.size,
      router: Boolean(registration.router),
      kind: dir.kind,
    });
    await this.emitPluginLifecycleEvent({
      kind: "loaded",
      plugin: manifest,
      sourceKind: dir.kind,
      sourceDir: pluginDir,
      toolsCount: tools.size,
      commandsCount: commands.size,
      router: Boolean(registration.router),
    });
  }

  private async emitPluginLifecycleEvent(params: {
    kind: "loaded" | "failed";
    plugin?: Pick<PluginManifestT, "id" | "name" | "version">;
    sourceKind: PluginDirKind;
    sourceDir: string;
    toolsCount?: number;
    commandsCount?: number;
    router?: boolean;
    reason?: string;
    error?: string;
  }): Promise<void> {
    if (!this.opts.container) return;
    try {
      const occurredAt = new Date().toISOString(),
        action = {
          type: "plugin.lifecycle",
          kind: params.kind,
          plugin_id: params.plugin?.id,
          plugin_name: params.plugin?.name,
          plugin_version: params.plugin?.version,
          source_kind: params.sourceKind,
          source_dir: params.sourceDir,
          tools_count: params.toolsCount,
          commands_count: params.commandsCount,
          router: params.router,
          reason: params.reason,
          error: params.error,
        };
      await this.opts.container.eventLog.appendNext(
        {
          tenantId: DEFAULT_TENANT_ID,
          replayId: randomUUID(),
          planKey: PLUGIN_LIFECYCLE_AUDIT_PLAN_ID,
          occurredAt,
          action,
        },
        async (tx, auditEvent) => {
          const evt: WsEventEnvelope = {
            event_id: randomUUID(),
            type: "plugin.lifecycle",
            occurred_at: occurredAt,
            scope: { kind: "global" },
            payload: {
              kind: params.kind,
              plugin: {
                id: params.plugin?.id,
                name: params.plugin?.name,
                version: params.plugin?.version,
                source_kind: params.sourceKind,
                source_dir: params.sourceDir,
                tools_count: params.toolsCount,
                commands_count: params.commandsCount,
                router: params.router,
              },
              reason: params.reason,
              error: params.error,
              audit: {
                plan_id: PLUGIN_LIFECYCLE_AUDIT_PLAN_ID,
                step_index: auditEvent.stepIndex,
                event_id: auditEvent.id,
              },
            },
          };
          await enqueueWsBroadcastMessage(tx, DEFAULT_TENANT_ID, evt, OPERATOR_WS_AUDIENCE);
        },
      );
    } catch (err) {
      this.opts.logger.warn("plugins.lifecycle_emit_failed", {
        plugin_id: params.plugin?.id,
        source_dir: params.sourceDir,
        kind: params.kind,
        reason: params.reason,
        error: errorMessage(err),
      });
    }
  }

  private async emitPluginToolInvokedEvent(params: {
    pluginId: string;
    pluginVersion: string;
    toolId: string;
    toolCallId: string;
    agentId: string;
    workspaceId: string;
    auditPlanId?: string;
    sessionId?: string;
    channel?: string;
    threadId?: string;
    policySnapshotId?: string;
    outcome: "succeeded" | "failed";
    error?: string;
    durationMs: number;
  }): Promise<void> {
    const sourcePlanId = params.auditPlanId?.trim();
    if (!this.opts.container || !sourcePlanId) return;
    try {
      const auditPlanId = `${PLUGIN_TOOL_INVOKED_AUDIT_PLAN_PREFIX}:${sourcePlanId}`,
        occurredAt = new Date().toISOString();
      const action = {
        type: "plugin_tool.invoked",
        plugin_id: params.pluginId,
        plugin_version: params.pluginVersion,
        tool_id: params.toolId,
        tool_call_id: params.toolCallId,
        agent_id: params.agentId,
        workspace_id: params.workspaceId,
        session_id: params.sessionId,
        channel: params.channel,
        thread_id: params.threadId,
        policy_snapshot_id: params.policySnapshotId,
        outcome: params.outcome,
        duration_ms: params.durationMs,
        error: params.error,
      };
      await this.opts.container.eventLog.appendNext(
        {
          tenantId: DEFAULT_TENANT_ID,
          replayId: randomUUID(),
          planKey: auditPlanId,
          occurredAt,
          action,
        },
        async (tx, auditEvent) => {
          const evt: WsEventEnvelope = {
            event_id: randomUUID(),
            type: "plugin_tool.invoked",
            occurred_at: occurredAt,
            scope: { kind: "agent", agent_id: params.agentId },
            payload: {
              plugin_id: params.pluginId,
              plugin_version: params.pluginVersion,
              tool_id: params.toolId,
              tool_call_id: params.toolCallId,
              agent_id: params.agentId,
              workspace_id: params.workspaceId,
              session_id: params.sessionId,
              channel: params.channel,
              thread_id: params.threadId,
              policy_snapshot_id: params.policySnapshotId,
              outcome: params.outcome,
              duration_ms: params.durationMs,
              error: params.error,
              audit: {
                plan_id: auditPlanId,
                step_index: auditEvent.stepIndex,
                event_id: auditEvent.id,
              },
            },
          };
          await enqueueWsBroadcastMessage(tx, DEFAULT_TENANT_ID, evt, OPERATOR_WS_AUDIENCE);
        },
      );
    } catch (err) {
      this.opts.logger.warn("plugins.tool_invoked_emit_failed", {
        plugin_id: params.pluginId,
        tool_id: params.toolId,
        tool_call_id: params.toolCallId,
        plan_id: sourcePlanId,
        audit_plan_id: `${PLUGIN_TOOL_INVOKED_AUDIT_PLAN_PREFIX}:${sourcePlanId}`,
        error: errorMessage(err),
      });
    }
  }
}
