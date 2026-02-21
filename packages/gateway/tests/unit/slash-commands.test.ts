/**
 * SlashCommandRegistry tests — verifies command registration, execution,
 * parsing, listing, and error handling.
 */

import { describe, it, expect } from "vitest";
import { SlashCommandRegistry } from "../../src/ws/slash-commands.js";
import type { SlashCommandContext } from "../../src/ws/slash-commands.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRegistry(): SlashCommandRegistry {
  return new SlashCommandRegistry();
}

// ---------------------------------------------------------------------------
// register + execute
// ---------------------------------------------------------------------------

describe("SlashCommandRegistry", () => {
  describe("register and execute", () => {
    it("executes a registered command and returns its result", async () => {
      const registry = createRegistry();
      registry.register("greet", async (ctx) => {
        return { output: `Hello, ${ctx.args[0] ?? "world"}!` };
      }, "Greet someone");

      const result = await registry.execute("/greet Alice", "client-1");
      expect(result.output).toBe("Hello, Alice!");
    });

    it("passes clientId to the handler context", async () => {
      const registry = createRegistry();
      let capturedCtx: SlashCommandContext | undefined;
      registry.register("whoami", async (ctx) => {
        capturedCtx = ctx;
        return { output: ctx.clientId };
      }, "Show client ID");

      await registry.execute("/whoami", "client-42");
      expect(capturedCtx).toBeDefined();
      expect(capturedCtx!.clientId).toBe("client-42");
    });

    it("passes rawInput to the handler context", async () => {
      const registry = createRegistry();
      let capturedRaw = "";
      registry.register("echo", async (ctx) => {
        capturedRaw = ctx.rawInput;
        return { output: "ok" };
      }, "Echo");

      await registry.execute("  /echo foo bar  ", "c-1");
      expect(capturedRaw).toBe("/echo foo bar");
    });

    it("returns result with optional data field", async () => {
      const registry = createRegistry();
      registry.register("data", async () => {
        return { output: "done", data: { count: 5 } };
      }, "Return data");

      const result = await registry.execute("/data", "c-1");
      expect(result.output).toBe("done");
      expect(result.data).toEqual({ count: 5 });
    });
  });

  // ---------------------------------------------------------------------------
  // Unknown command
  // ---------------------------------------------------------------------------

  describe("unknown command", () => {
    it("returns helpful error with available commands list", async () => {
      const registry = createRegistry();
      registry.register("help", async () => ({ output: "help" }), "Show help");
      registry.register("status", async () => ({ output: "ok" }), "Show status");

      const result = await registry.execute("/unknown", "c-1");
      expect(result.output).toContain("Unknown command: /unknown");
      expect(result.output).toContain("/help");
      expect(result.output).toContain("/status");
    });

    it("returns empty available list when no commands registered", async () => {
      const registry = createRegistry();

      const result = await registry.execute("/foo", "c-1");
      expect(result.output).toContain("Unknown command: /foo");
      expect(result.output).toContain("Available:");
    });
  });

  // ---------------------------------------------------------------------------
  // isCommand
  // ---------------------------------------------------------------------------

  describe("isCommand", () => {
    it("returns true for strings starting with /", () => {
      const registry = createRegistry();
      expect(registry.isCommand("/status")).toBe(true);
    });

    it("returns true for strings with leading whitespace before /", () => {
      const registry = createRegistry();
      expect(registry.isCommand("  /help")).toBe(true);
    });

    it("returns false for non-slash strings", () => {
      const registry = createRegistry();
      expect(registry.isCommand("hello")).toBe(false);
    });

    it("returns false for empty string", () => {
      const registry = createRegistry();
      expect(registry.isCommand("")).toBe(false);
    });

    it("returns false for strings with / not at start", () => {
      const registry = createRegistry();
      expect(registry.isCommand("hello /world")).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // listCommands
  // ---------------------------------------------------------------------------

  describe("listCommands", () => {
    it("returns all registered commands with names and descriptions", () => {
      const registry = createRegistry();
      registry.register("help", async () => ({ output: "" }), "Show help");
      registry.register("status", async () => ({ output: "" }), "Show status");

      const list = registry.listCommands();
      expect(list).toHaveLength(2);
      expect(list).toContainEqual({ name: "/help", description: "Show help" });
      expect(list).toContainEqual({ name: "/status", description: "Show status" });
    });

    it("returns empty array when no commands registered", () => {
      const registry = createRegistry();
      expect(registry.listCommands()).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Empty / malformed input
  // ---------------------------------------------------------------------------

  describe("empty and malformed input", () => {
    it("returns 'Not a slash command' for non-slash input", async () => {
      const registry = createRegistry();
      const result = await registry.execute("hello world", "c-1");
      expect(result.output).toBe("Not a slash command");
    });

    it("returns 'Empty command' for bare slash", async () => {
      const registry = createRegistry();
      const result = await registry.execute("/", "c-1");
      expect(result.output).toBe("Empty command");
    });

    it("returns 'Empty command' for slash with only whitespace", async () => {
      const registry = createRegistry();
      const result = await registry.execute("/   ", "c-1");
      expect(result.output).toBe("Empty command");
    });

    it("returns 'Not a slash command' for empty string", async () => {
      const registry = createRegistry();
      const result = await registry.execute("", "c-1");
      expect(result.output).toBe("Not a slash command");
    });

    it("returns 'Not a slash command' for whitespace-only string", async () => {
      const registry = createRegistry();
      const result = await registry.execute("   ", "c-1");
      expect(result.output).toBe("Not a slash command");
    });
  });

  // ---------------------------------------------------------------------------
  // Args parsing
  // ---------------------------------------------------------------------------

  describe("args parsing", () => {
    it("splits arguments by whitespace", async () => {
      const registry = createRegistry();
      let capturedArgs: string[] = [];
      registry.register("cmd", async (ctx) => {
        capturedArgs = ctx.args;
        return { output: "ok" };
      }, "Test");

      await registry.execute("/cmd arg1 arg2 arg3", "c-1");
      expect(capturedArgs).toEqual(["arg1", "arg2", "arg3"]);
    });

    it("passes empty args for command with no arguments", async () => {
      const registry = createRegistry();
      let capturedArgs: string[] = [];
      registry.register("cmd", async (ctx) => {
        capturedArgs = ctx.args;
        return { output: "ok" };
      }, "Test");

      await registry.execute("/cmd", "c-1");
      expect(capturedArgs).toEqual([]);
    });

    it("collapses multiple whitespace between arguments", async () => {
      const registry = createRegistry();
      let capturedArgs: string[] = [];
      registry.register("cmd", async (ctx) => {
        capturedArgs = ctx.args;
        return { output: "ok" };
      }, "Test");

      await registry.execute("/cmd   arg1    arg2", "c-1");
      expect(capturedArgs).toEqual(["arg1", "arg2"]);
    });

    it("normalizes command name to lowercase", async () => {
      const registry = createRegistry();
      registry.register("status", async () => ({ output: "ok" }), "Status");

      const result = await registry.execute("/STATUS", "c-1");
      expect(result.output).toBe("ok");
    });
  });
});
