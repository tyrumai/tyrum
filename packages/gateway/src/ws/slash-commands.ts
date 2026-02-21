/**
 * Slash command registry for WS clients.
 *
 * Provides a simple command dispatch system where clients send `/command args`
 * strings over WS and receive structured results.
 */

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

export class SlashCommandRegistry {
  private readonly commands = new Map<string, { handler: SlashCommandHandler; description: string }>();

  /** Register a slash command. */
  register(name: string, handler: SlashCommandHandler, description: string): void {
    this.commands.set(name.toLowerCase(), { handler, description });
  }

  /** Parse and execute a slash command. */
  async execute(input: string, clientId: string): Promise<SlashCommandResult> {
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

    return entry.handler({
      clientId,
      args: parts.slice(1),
      rawInput: trimmed,
    });
  }

  /** List all registered commands. */
  listCommands(): Array<{ name: string; description: string }> {
    return Array.from(this.commands.entries()).map(([name, entry]) => ({
      name: `/${name}`,
      description: entry.description,
    }));
  }

  /** Check if a string looks like a slash command. */
  isCommand(input: string): boolean {
    return input.trim().startsWith("/");
  }
}
