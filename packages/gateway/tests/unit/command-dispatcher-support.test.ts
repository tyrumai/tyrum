import { describe, expect, it } from "vitest";
import { resolveAgentId } from "../../src/modules/commands/dispatcher-support.js";
import type { CommandDeps } from "../../src/modules/commands/dispatcher.js";

function commandContext(
  value: NonNullable<CommandDeps["commandContext"]>,
): CommandDeps["commandContext"] {
  return value;
}

describe("resolveAgentId", () => {
  it("prefers an explicit command-context agent id", () => {
    expect(
      resolveAgentId(
        commandContext({
          agentId: "ops-agent",
          key: "hook:550e8400-e29b-41d4-a716-446655440000",
        }),
      ),
    ).toBe("ops-agent");
  });

  it("extracts the agent key from agent session keys", () => {
    expect(
      resolveAgentId(
        commandContext({
          key: "agent:ops-agent:main",
        }),
      ),
    ).toBe("ops-agent");
  });

  it("falls back to the default agent for valid non-agent keys", () => {
    expect(
      resolveAgentId(
        commandContext({
          key: "hook:550e8400-e29b-41d4-a716-446655440000",
        }),
      ),
    ).toBe("default");
  });

  it("falls back to the default agent when the key does not parse", () => {
    expect(
      resolveAgentId(
        commandContext({
          key: "legacy-session-key",
        }),
      ),
    ).toBe("default");
  });
});
