import { describe, expect, it } from "vitest";
import type { ActionPrimitive, ClientCapability } from "@tyrum/schemas";
import type { CapabilityProvider, TaskResult } from "@tyrum/client";
import { NodeRuntime } from "../src/main/node-runtime.js";
import { resolvePermissions } from "../src/main/config/permissions.js";
import { DEFAULT_CONFIG } from "../src/main/config/schema.js";

function makeProvider(capability: ClientCapability): CapabilityProvider {
  return {
    capability,
    execute: async (_action: ActionPrimitive): Promise<TaskResult> => ({
      success: true,
    }),
  };
}

function readEnabledCapabilities(runtime: NodeRuntime): ClientCapability[] {
  return (
    runtime as unknown as { getEnabledCapabilities: () => ClientCapability[] }
  ).getEnabledCapabilities();
}

describe("NodeRuntime capability advertisement", () => {
  const callbacks = {
    onStatusChange: () => {},
    onConsentRequest: () => {},
    onPlanUpdate: () => {},
    onLog: () => {},
  };

  it("advertises only capabilities with registered providers", () => {
    const runtime = new NodeRuntime(
      {
        ...DEFAULT_CONFIG,
        capabilities: {
          desktop: true,
          playwright: true,
          cli: true,
          http: true,
        },
      },
      resolvePermissions("balanced", {}),
      callbacks,
    );

    runtime.registerProvider(makeProvider("desktop"));
    runtime.registerProvider(makeProvider("cli"));

    expect(readEnabledCapabilities(runtime)).toEqual(["desktop", "cli"]);
  });

  it("deduplicates capability advertisement by provider capability", () => {
    const runtime = new NodeRuntime(
      DEFAULT_CONFIG,
      resolvePermissions("balanced", {}),
      callbacks,
    );

    runtime.registerProvider(makeProvider("desktop"));
    runtime.registerProvider(makeProvider("desktop"));

    expect(readEnabledCapabilities(runtime)).toEqual(["desktop"]);
  });
});
