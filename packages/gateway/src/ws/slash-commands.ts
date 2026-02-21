/**
 * Slash command registry for WS clients.
 *
 * Provides a simple command dispatch system where clients send `/command args`
 * strings over WS and receive structured results.
 */

import type { PolicyBundleManager } from "../modules/policy/bundle.js";

export interface SlashCommandContext {
  clientId: string;
  args: string[];
  rawInput: string;
}

export interface SlashCommandResult {
  output: string;
  data?: unknown;
}

export type SlashCommandHandler = (ctx: SlashCommandContext) => Promise<SlashCommandResult>;

export interface SlashCommandEntry {
  handler: SlashCommandHandler;
  description: string;
  readonly: boolean;
}

export class SlashCommandRegistry {
  private readonly commands = new Map<string, SlashCommandEntry>();

  /** Register a slash command. */
  register(name: string, handler: SlashCommandHandler, description: string, opts?: { readonly?: boolean }): void {
    this.commands.set(name.toLowerCase(), { handler, description, readonly: opts?.readonly ?? false });
  }

  /** Parse and execute a slash command. */
  async execute(
    input: string,
    clientId: string,
    opts?: { policyBundleManager?: PolicyBundleManager },
  ): Promise<SlashCommandResult> {
    const trimmed = input.trim();
    if (!trimmed.startsWith("/")) {
      return { output: "Not a slash command" };
    }

    const parts = trimmed.slice(1).split(/\s+/);
    const name = parts[0]?.toLowerCase();
    if (!name) {
      return { output: "Empty command" };
    }

    const entry = this.commands.get(name);
    if (!entry) {
      const available = Array.from(this.commands.keys()).map(k => `/${k}`).join(", ");
      return { output: `Unknown command: /${name}. Available: ${available}` };
    }

    // Policy gate: non-readonly commands require policy check
    if (!entry.readonly && opts?.policyBundleManager) {
      const decision = opts.policyBundleManager.evaluate("commands", { command: name });
      if (decision.action === "deny") {
        return { output: `Command /${name} blocked by policy` };
      }
    }

    return entry.handler({
      clientId,
      args: parts.slice(1),
      rawInput: trimmed,
    });
  }

  /** Get entry for a command (exposed for policy checks). */
  getEntry(name: string): SlashCommandEntry | undefined {
    return this.commands.get(name.toLowerCase());
  }

  /** List all registered commands. */
  listCommands(): Array<{ name: string; description: string; readonly: boolean }> {
    return Array.from(this.commands.entries()).map(([name, entry]) => ({
      name: `/${name}`,
      description: entry.description,
      readonly: entry.readonly,
    }));
  }

  /** Check if a string looks like a slash command. */
  isCommand(input: string): boolean {
    return input.trim().startsWith("/");
  }
}
