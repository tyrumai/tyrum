import { PluginManifest } from "@tyrum/schemas";
import type { PluginManifest as PluginManifestT } from "@tyrum/schemas";
import { Ajv2019 } from "ajv/dist/2019.js";
import type { ErrorObject } from "ajv";
import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";
import type { Hono } from "hono";
import type { GatewayContainer } from "../../container.js";
import type { Logger } from "../observability/logger.js";
import type { ToolDescriptor } from "../agent/tools.js";

export type PluginCommandExecuteResult = {
  output: string;
  data?: unknown;
};

export type PluginToolExecuteResult = {
  output: string;
  error?: string;
};

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
  entry_path: string;
  tools: Map<string, PluginToolRegistration>;
  commands: Map<string, PluginCommandRegistration>;
  router?: Hono;
  loaded_at: string;
};

const REQUIRED_MANIFEST_FIELDS = ["id", "name", "version", "entry", "contributes", "permissions", "config_schema"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function missingRequiredManifestFields(value: Record<string, unknown>): string[] {
  return REQUIRED_MANIFEST_FIELDS.filter((field) => !Object.prototype.hasOwnProperty.call(value, field));
}

function parseJsonOrYaml(contents: string, hintPath?: string): unknown {
  const trimmed = contents.trim();
  if (trimmed.length === 0) return {};
  const isJson = hintPath?.toLowerCase().endsWith(".json") ?? trimmed.startsWith("{");
  if (isJson) {
    return JSON.parse(trimmed) as unknown;
  }
  return parseYaml(trimmed) as unknown;
}

function isJsonSchemaObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

function normalizeJsonSchemaAdditionalPropertiesDefaults(
  schema: unknown,
  seen = new WeakMap<object, unknown>(),
  opts?: { skipAdditionalPropertiesDefault?: boolean },
): unknown {
  if (schema === null || typeof schema !== "object") return schema;
  const existing = seen.get(schema);
  if (existing) return existing;

  if (Array.isArray(schema)) {
    const out: unknown[] = [];
    seen.set(schema, out);
    for (const item of schema) {
      out.push(normalizeJsonSchemaAdditionalPropertiesDefaults(item, seen, opts));
    }
    return out;
  }

  const record = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  seen.set(schema, out);

  const skipAdditionalPropertiesDefault = opts?.skipAdditionalPropertiesDefault ?? false;
  const additionalPropertiesExplicit = Object.prototype.hasOwnProperty.call(record, "additionalProperties");
  const unevaluatedPropertiesExplicit = Object.prototype.hasOwnProperty.call(record, "unevaluatedProperties");
  const allOf = record["allOf"];
  const hasAllOf = Array.isArray(allOf) && allOf.length > 0;

  const type = record["type"];
  const isObjectType = type === "object" || (Array.isArray(type) && type.includes("object"));
  const hasProperties =
    Object.prototype.hasOwnProperty.call(record, "properties") ||
    Object.prototype.hasOwnProperty.call(record, "patternProperties");
  const isObjectSchema = isObjectType || hasProperties;

  for (const [key, value] of Object.entries(record)) {
    switch (key) {
      case "additionalProperties":
      case "unevaluatedProperties": {
        out[key] =
          typeof value === "boolean"
            ? value
            : normalizeJsonSchemaAdditionalPropertiesDefaults(value, seen);
        break;
      }
      case "items":
      case "contains":
      case "not":
      case "if":
      case "then":
      case "else":
      case "propertyNames":
      case "unevaluatedItems":
      case "additionalItems": {
        out[key] = normalizeJsonSchemaAdditionalPropertiesDefaults(value, seen);
        break;
      }
      case "prefixItems":
      case "anyOf":
      case "oneOf": {
        out[key] = Array.isArray(value)
          ? value.map((entry) => normalizeJsonSchemaAdditionalPropertiesDefaults(entry, seen))
          : value;
        break;
      }
      case "allOf": {
        out[key] = Array.isArray(value)
          ? value.map((entry) =>
              normalizeJsonSchemaAdditionalPropertiesDefaults(entry, seen, {
                skipAdditionalPropertiesDefault: true,
              }),
            )
          : value;
        break;
      }
      case "properties":
      case "patternProperties":
      case "$defs":
      case "definitions":
      case "dependentSchemas": {
        if (!isRecord(value)) {
          out[key] = value;
          break;
        }
        const normalized: Record<string, unknown> = {};
        for (const [prop, schemaValue] of Object.entries(value)) {
          normalized[prop] = normalizeJsonSchemaAdditionalPropertiesDefaults(schemaValue, seen);
        }
        out[key] = normalized;
        break;
      }
      default:
        out[key] = value;
        break;
    }
  }

  if (
    !skipAdditionalPropertiesDefault &&
    !additionalPropertiesExplicit &&
    !unevaluatedPropertiesExplicit
  ) {
    if (hasAllOf) {
      out["unevaluatedProperties"] = false;
    } else if (isObjectSchema) {
      out["additionalProperties"] = false;
    }
  }

  return out;
}

async function tryReadFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return undefined;
  }
}

async function loadManifestFromDir(dir: string): Promise<{ path: string; manifest: PluginManifestT } | undefined> {
  const candidates = ["plugin.yml", "plugin.yaml", "plugin.json"];
  for (const filename of candidates) {
    const path = join(dir, filename);
    const raw = await tryReadFile(path);
    if (!raw) continue;
    const parsed = parseJsonOrYaml(raw, path);
    if (!isRecord(parsed)) {
      throw new Error("manifest must be an object");
    }
    const missingFields = missingRequiredManifestFields(parsed);
    if (missingFields.length > 0) {
      throw new Error(`missing required manifest field(s): ${missingFields.join(", ")}`);
    }
    return { path, manifest: PluginManifest.parse(parsed) };
  }
  return undefined;
}

async function loadConfigFromDir(dir: string): Promise<{ path?: string; config: unknown }> {
  const candidates = ["config.yml", "config.yaml", "config.json"];
  for (const filename of candidates) {
    const path = join(dir, filename);
    const raw = await tryReadFile(path);
    if (!raw) continue;
    try {
      const parsed = parseJsonOrYaml(raw, path);
      return { path, config: parsed };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`failed to parse config (${filename}): ${message}`);
    }
  }
  return { config: {} };
}

function validatePluginConfig(params: {
  schema: unknown;
  config: unknown;
}): { ok: true; normalizedSchema: Record<string, unknown>; config: unknown } | { ok: false; error: string } {
  const normalizedSchema = normalizeJsonSchemaAdditionalPropertiesDefaults(params.schema);
  if (!isJsonSchemaObject(normalizedSchema)) {
    return { ok: false, error: "config_schema must be a JSON Schema object" };
	  }

	  try {
	    const ajv = new Ajv2019({ allErrors: true, strict: false });
	    const validate = ajv.compile(normalizedSchema);
	    const ok = validate(params.config);
	    if (ok) {
	      return { ok: true, normalizedSchema, config: params.config };
	    }
	    const errors = ((validate.errors ?? []) as ErrorObject[])
	      .map((err) => {
	        const at = err.instancePath && err.instancePath.length > 0 ? err.instancePath : "/";
	        const msg = err.message ? String(err.message) : "invalid";
	        return `${at}: ${msg}`;
	      })
	      .filter((entry) => entry.length > 0);
    return {
      ok: false,
      error: errors.length > 0 ? errors.join("; ") : "config does not match schema",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

function tryReadPackageJsonName(path: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    if (!isRecord(parsed)) return undefined;
    const name = parsed["name"];
    return typeof name === "string" ? name : undefined;
  } catch {
    return undefined;
  }
}

function resolveBundledPluginsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolveBundledPluginsDirFrom(here);
}

export function resolveBundledPluginsDirFrom(startDir: string): string {
  // We cannot rely on the source tree depth because tsdown bundles the gateway
  // into `dist/index.mjs`, making `import.meta.url` point at `dist/`.
  //
  // We also cannot simply look for a `plugins/` directory because this module
  // itself lives under `src/modules/plugins/`.
  //
  // Instead, find the `@tyrum/gateway` package root and return `<root>/plugins`.
  let current = startDir;
  for (let i = 0; i < 10; i += 1) {
    const name = tryReadPackageJsonName(join(current, "package.json"));
    if (name === "@tyrum/gateway") {
      return join(current, "plugins");
    }

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  // Fallback to the historical source layout.
  return join(startDir, "../../../plugins");
}

function resolvePluginsDir(home: string): string {
  return join(home, "plugins");
}

function resolveSafeChildPath(parent: string, child: string): string {
  const absParent = resolve(parent);
  const absChild = resolve(absParent, child);
  const rel = relative(absParent, absChild);
  if (rel === "" || (!rel.startsWith("..") && !rel.startsWith("../") && !rel.includes(".."))) {
    return absChild;
  }
  throw new Error(`path escapes plugin directory: ${child}`);
}

function normalizePluginId(id: string): string {
  const trimmed = id.trim();
  return trimmed.length > 0 ? trimmed : "plugin";
}

function toolIdAllowed(manifest: PluginManifestT, toolId: string): boolean {
  return Boolean(manifest.contributes?.tools?.includes(toolId));
}

function commandAllowed(manifest: PluginManifestT, name: string): boolean {
  return Boolean(manifest.contributes?.commands?.includes(name));
}

function cloneManifest(manifest: PluginManifestT): PluginManifestT {
  return structuredClone(manifest) as PluginManifestT;
}

function selectContainerForPlugin(manifest: PluginManifestT, container?: GatewayContainer): GatewayContainer | undefined {
  if (!container) return undefined;
  if (manifest.permissions?.db) return container;
  return undefined;
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
  }): Promise<PluginRegistry> {
    const registry = new PluginRegistry({
      logger: opts.logger,
      container: opts.container,
      fetchImpl: opts.fetchImpl,
    });

    const dirs: Array<{ kind: "workspace" | "user" | "bundled"; path: string }> = [];
    dirs.push({ kind: "workspace", path: resolvePluginsDir(opts.home) });
    if (opts.userHome) {
      dirs.push({ kind: "user", path: resolvePluginsDir(opts.userHome) });
    }
    dirs.push({ kind: "bundled", path: resolveBundledPluginsDir() });

    await registry.loadFromDirectories(dirs);
    return registry;
  }

  list(): Array<{
    id: string;
    name: string;
    version: string;
    contributions: PluginManifestT["contributes"] | undefined;
    permissions: PluginManifestT["permissions"] | undefined;
    loaded_at: string;
    source_dir: string;
  }> {
    return [...this.plugins.values()]
      .map((p) => ({
        id: p.manifest.id,
        name: p.manifest.name,
        version: p.manifest.version,
        contributions: p.manifest.contributes,
        permissions: p.manifest.permissions,
        loaded_at: p.loaded_at,
        source_dir: p.source_dir,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  getManifest(pluginId: string): PluginManifestT | undefined {
    const id = normalizePluginId(pluginId);
    return this.plugins.get(id)?.manifest;
  }

  getToolDescriptors(): ToolDescriptor[] {
    const out: ToolDescriptor[] = [];
    for (const plugin of this.plugins.values()) {
      for (const tool of plugin.tools.values()) {
        out.push(tool.descriptor);
      }
    }
    return out;
  }

  getTool(toolId: string): { plugin: PluginManifestT; tool: PluginToolRegistration } | undefined {
    for (const plugin of this.plugins.values()) {
      const tool = plugin.tools.get(toolId);
      if (tool) {
        return { plugin: plugin.manifest, tool };
      }
    }
    return undefined;
  }

  async executeTool(params: {
    toolId: string;
    args: unknown;
    home: string;
    agentId: string;
    workspaceId: string;
  }): Promise<PluginToolExecuteResult | undefined> {
    const found = this.getTool(params.toolId);
    if (!found) return undefined;

    try {
      return await found.tool.execute(params.args, {
        home: params.home,
        agent_id: params.agentId,
        workspace_id: params.workspaceId,
        logger: this.opts.logger,
        fetch: this.opts.fetchImpl ?? fetch,
        container: selectContainerForPlugin(found.plugin, this.opts.container),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { output: "", error: message };
    }
  }

  async tryExecuteCommand(
    raw: string,
  ): Promise<PluginCommandExecuteResult | undefined> {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return undefined;
    const normalized = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
    const parts = normalized.trim().split(/\s+/g).filter((p) => p.length > 0);
    if (parts.length === 0) return undefined;

    const name = parts[0]!;
    const args = parts.slice(1);

    for (const plugin of this.plugins.values()) {
      const cmd = plugin.commands.get(name);
      if (!cmd) continue;
      try {
        return await cmd.execute(args, {
          logger: this.opts.logger,
          container: selectContainerForPlugin(plugin.manifest, this.opts.container),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { output: `Plugin command '${name}' failed: ${message}` };
      }
    }

    return undefined;
  }

  routers(): Array<{ pluginId: string; router: Hono }> {
    const out: Array<{ pluginId: string; router: Hono }> = [];
    for (const plugin of this.plugins.values()) {
      if (plugin.router) {
        out.push({ pluginId: plugin.manifest.id, router: plugin.router });
      }
    }
    return out;
  }

  private async loadFromDirectories(
    dirs: Array<{ kind: "workspace" | "user" | "bundled"; path: string }>,
  ): Promise<void> {
    for (const dir of dirs) {
      let entries;
      try {
        entries = await readdir(dir.path, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const pluginDir = join(dir.path, entry.name);
        let manifestFile: { path: string; manifest: PluginManifestT } | undefined;
        try {
          manifestFile = await loadManifestFromDir(pluginDir);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.opts.logger.warn("plugins.invalid_manifest", {
            source_dir: pluginDir,
            error: message,
          });
          continue;
        }
        if (!manifestFile) continue;

        const id = normalizePluginId(manifestFile.manifest.id);
        if (this.plugins.has(id)) {
          // Higher-precedence directory already registered this plugin id.
          continue;
        }

        const manifest = cloneManifest({ ...manifestFile.manifest, id });
        if (!manifest.entry) {
          this.opts.logger.warn("plugins.missing_entry", {
            plugin_id: id,
            source_dir: pluginDir,
          });
          continue;
        }

        let configPath: string | undefined;
        let config: unknown;
        try {
          const loadedConfig = await loadConfigFromDir(pluginDir);
          configPath = loadedConfig.path;
          config = loadedConfig.config;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.opts.logger.warn("plugins.invalid_config", {
            plugin_id: id,
            source_dir: pluginDir,
            error: message,
          });
          continue;
        }
        const configValidation = validatePluginConfig({
          schema: manifest.config_schema,
          config,
        });
        if (!configValidation.ok) {
          this.opts.logger.warn("plugins.invalid_config", {
            plugin_id: id,
            source_dir: pluginDir,
            config_path: configPath,
            error: configValidation.error,
          });
          continue;
        }
        manifest.config_schema = configValidation.normalizedSchema;

        const entryPath = resolveSafeChildPath(pluginDir, manifest.entry);

        let registerFn: PluginRegisterFn | undefined;
        try {
          const mod = (await import(pathToFileURL(entryPath).href)) as Record<string, unknown>;
          const candidate = mod["registerPlugin"];
          if (typeof candidate === "function") {
            registerFn = candidate as PluginRegisterFn;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.opts.logger.warn("plugins.import_failed", {
            plugin_id: id,
            source_dir: pluginDir,
            entry_path: entryPath,
            error: message,
          });
          continue;
        }

        if (!registerFn) {
          this.opts.logger.warn("plugins.missing_register", {
            plugin_id: id,
            source_dir: pluginDir,
            entry_path: entryPath,
          });
          continue;
        }

        let registration: PluginRegistration;
        try {
          const manifestForRegistration = cloneManifest(manifest);
          registration = await Promise.resolve(
            registerFn({
              manifest: manifestForRegistration,
              config: configValidation.config,
              logger: this.opts.logger.child({ plugin_id: id }),
            }),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.opts.logger.warn("plugins.register_failed", {
            plugin_id: id,
            source_dir: pluginDir,
            error: message,
          });
          continue;
        }

        const tools = new Map<string, PluginToolRegistration>();
        const undeclaredTools: string[] = [];
        for (const tool of registration.tools ?? []) {
          if (!tool?.descriptor || typeof tool.execute !== "function") continue;
          const toolId = tool.descriptor.id?.trim?.() ?? "";
          if (!toolId) continue;
          if (!toolIdAllowed(manifest, toolId)) {
            undeclaredTools.push(toolId);
            continue;
          }
          tools.set(toolId, tool);
        }

        const commands = new Map<string, PluginCommandRegistration>();
        const undeclaredCommands: string[] = [];
        for (const cmd of registration.commands ?? []) {
          if (!cmd || typeof cmd.name !== "string" || typeof cmd.execute !== "function") continue;
          const name = cmd.name.trim();
          if (!name) continue;
          if (!commandAllowed(manifest, name)) {
            undeclaredCommands.push(name);
            continue;
          }
          commands.set(name, cmd);
        }

        const undeclaredRouter = Boolean(registration.router) && (manifest.contributes?.routes?.length ?? 0) === 0;
        if (undeclaredTools.length > 0 || undeclaredCommands.length > 0 || undeclaredRouter) {
          this.opts.logger.warn("plugins.undeclared_contributions", {
            plugin_id: id,
            source_dir: pluginDir,
            tools: undeclaredTools,
            commands: undeclaredCommands,
            router: undeclaredRouter,
          });
          continue;
        }

        this.plugins.set(id, {
          manifest,
          source_dir: pluginDir,
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
      }
    }
  }
}
