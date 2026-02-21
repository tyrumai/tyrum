/**
 * Built-in slash commands available to all WS clients.
 */

import type { SlashCommandRegistry } from "./slash-commands.js";

/**
 * Register built-in slash commands.
 * These are the default commands available to all WS clients.
 */
export function registerBuiltinCommands(
  registry: SlashCommandRegistry,
  deps: {
    getStatus?: () => Promise<{ version: string; uptime: number; clients: number }>;
  },
): void {
  registry.register("status", async () => {
    if (deps.getStatus) {
      const status = await deps.getStatus();
      return {
        output: `Gateway v${status.version} | Uptime: ${Math.floor(status.uptime / 1000)}s | Clients: ${status.clients}`,
        data: status,
      };
    }
    return { output: "Status information not available" };
  }, "Show gateway status", { readonly: true });

  registry.register("help", async () => {
    const list = registry.listCommands();
    const lines = list.map(c => `  ${c.name} — ${c.description}`);
    return {
      output: `Available commands:\n${lines.join("\n")}`,
      data: list,
    };
  }, "List available commands", { readonly: true });

  registry.register("ping", async () => {
    return { output: "pong", data: { timestamp: new Date().toISOString() } };
  }, "Check connectivity", { readonly: true });
}
