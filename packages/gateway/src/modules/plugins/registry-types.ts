import type { PluginManifest as PluginManifestT } from "@tyrum/schemas";
import type { Hono } from "hono";
import type { GatewayContainer } from "../../container.js";
import type { ToolDescriptor } from "../agent/tools.js";
import type { Logger } from "../observability/logger.js";

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

export type LoadedPlugin = {
  manifest: PluginManifestT;
  source_dir: string;
  install?: import("./lockfile.js").PluginInstallInfo;
  entry_path: string;
  tools: Map<string, PluginToolRegistration>;
  commands: Map<string, PluginCommandRegistration>;
  router?: Hono;
  loaded_at: string;
};
export type NormalizeSchemaOptions = {
  root?: unknown;
  skipAdditionalPropertiesDefault?: boolean;
  skipAdditionalPropertiesDefaultFor?: WeakSet<object>;
};
