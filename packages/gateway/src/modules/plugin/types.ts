import type { Logger } from "../observability/logger.js";

export interface ToolDescriptor {
  id: string;
  description: string;
  risk: "low" | "medium" | "high";
  requires_confirmation: boolean;
}

export interface CommandHandler {
  (args: string[]): Promise<string>;
}

export interface PluginContext {
  registerTool(descriptor: ToolDescriptor): void;
  registerCommand(name: string, handler: CommandHandler): void;
  getConfig(): Record<string, unknown>;
  log: Logger;
}

export interface PluginInterface {
  onLoad(ctx: PluginContext): Promise<void>;
  onEnable?(ctx: PluginContext): Promise<void>;
  onDisable?(ctx: PluginContext): Promise<void>;
  onUnload?(): Promise<void>;
}
