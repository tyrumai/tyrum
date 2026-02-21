/**
 * Built-in slash command tests — verifies /status, /help, and /ping.
 */

import { describe, it, expect, vi } from "vitest";
import { SlashCommandRegistry } from "../../src/ws/slash-commands.js";
import { registerBuiltinCommands } from "../../src/ws/builtin-commands.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRegistryWithBuiltins(
  deps?: Parameters<typeof registerBuiltinCommands>[1],
): SlashCommandRegistry {
  const registry = new SlashCommandRegistry();
  registerBuiltinCommands(registry, deps ?? {});
  return registry;
}

// ---------------------------------------------------------------------------
// /status
// ---------------------------------------------------------------------------

describe("/status", () => {
  it("returns gateway info when getStatus is provided", async () => {
    const getStatus = vi.fn().mockResolvedValue({
      version: "1.2.3",
      uptime: 60_000,
      clients: 5,
    });

    const registry = createRegistryWithBuiltins({ getStatus });
    const result = await registry.execute("/status", "c-1");

    expect(result.output).toContain("v1.2.3");
    expect(result.output).toContain("60s");
    expect(result.output).toContain("5");
    expect(result.data).toEqual({
      version: "1.2.3",
      uptime: 60_000,
      clients: 5,
    });
  });

  it("returns fallback message when getStatus is not provided", async () => {
    const registry = createRegistryWithBuiltins({});
    const result = await registry.execute("/status", "c-1");

    expect(result.output).toBe("Status information not available");
    expect(result.data).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// /help
// ---------------------------------------------------------------------------

describe("/help", () => {
  it("lists all registered commands", async () => {
    const registry = createRegistryWithBuiltins({});
    const result = await registry.execute("/help", "c-1");

    expect(result.output).toContain("/status");
    expect(result.output).toContain("/help");
    expect(result.output).toContain("/ping");
    expect(result.output).toContain("Show gateway status");
    expect(result.output).toContain("List available commands");
    expect(result.output).toContain("Check connectivity");

    expect(Array.isArray(result.data)).toBe(true);
    const data = result.data as Array<{ name: string; description: string }>;
    expect(data.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// /ping
// ---------------------------------------------------------------------------

describe("/ping", () => {
  it("returns pong with timestamp", async () => {
    const registry = createRegistryWithBuiltins({});
    const result = await registry.execute("/ping", "c-1");

    expect(result.output).toBe("pong");
    expect(result.data).toBeDefined();
    const data = result.data as { timestamp: string };
    expect(typeof data.timestamp).toBe("string");
    // Verify it's a valid ISO timestamp
    expect(new Date(data.timestamp).toISOString()).toBe(data.timestamp);
  });
});
