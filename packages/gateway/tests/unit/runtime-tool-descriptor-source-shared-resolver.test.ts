import { AgentConfig } from "@tyrum/contracts";
import { describe, expect, it, vi } from "vitest";
import { listAvailableRuntimeTools } from "../../src/modules/agent/runtime/agent-runtime-status.js";
import { resolveRuntimeToolDescriptorSource } from "../../src/modules/agent/runtime/runtime-tool-descriptor-source.js";
import * as effectiveExposureResolver from "../../src/modules/agent/runtime/effective-exposure-resolver.js";

describe("runtime tool descriptor source shared resolver wiring", () => {
  it("routes runtime descriptor aggregation through the shared exposure resolver", async () => {
    const exposureSpy = vi.spyOn(effectiveExposureResolver, "resolveEffectiveToolExposureVerdicts");
    const loaded = {
      config: AgentConfig.parse({
        model: { model: "openai/gpt-4.1" },
        tools: {
          bundle: "authoring-core",
          tier: "default",
          default_mode: "allow",
          allow: [],
          deny: [],
        },
        mcp: {
          bundle: "workspace-default",
          tier: "advanced",
          default_mode: "allow",
          allow: [],
          deny: [],
        },
      }),
      identity: {} as never,
      skills: [],
      mcpServers: [],
    };

    await listAvailableRuntimeTools({
      opts: {
        container: {
          deploymentConfig: {},
          db: {} as never,
          approvalDal: {} as never,
          logger: { warn: vi.fn() },
          redactionEngine: {} as never,
        },
      } as never,
      mcpManager: {
        listToolDescriptors: vi.fn().mockResolvedValue([]),
      } as never,
      loaded,
      plugins: {
        getToolDescriptors: vi.fn().mockReturnValue([]),
      } as never,
    });

    expect(exposureSpy).toHaveBeenCalled();
    expect(
      exposureSpy.mock.calls.some(
        ([input]) => input.stateMode === "local" && input.candidates.length > 0,
      ),
    ).toBe(true);
  });

  it("keeps invalid-schema tools in the shared inventory but out of available runtime tools", async () => {
    const source = await resolveRuntimeToolDescriptorSource({
      ctx: {
        config: AgentConfig.parse({
          model: { model: "openai/gpt-4.1" },
          tools: {
            default_mode: "deny",
            allow: ["plugin.echo.invalid"],
            deny: [],
          },
        }),
        identity: {} as never,
        skills: [],
        mcpServers: [],
      },
      mcpManager: {
        listToolDescriptors: vi.fn().mockResolvedValue([]),
      } as never,
      plugins: {
        getToolDescriptors: vi.fn().mockReturnValue([
          {
            id: "plugin.echo.invalid",
            description: "Invalid plugin state.",
            effect: "read_only" as const,
            keywords: ["plugin", "echo"],
            inputSchema: {
              oneOf: [{ type: "object", properties: {} }],
            },
          },
        ]),
      } as never,
      stateMode: "local",
    });

    expect(source.availableTools.map((tool) => tool.id)).not.toContain("plugin.echo.invalid");
    expect(source.effectiveExposureVerdicts).toContainEqual(
      expect.objectContaining({
        exposureClass: "plugin",
        enabledByAgent: true,
        enabled: false,
        reason: "disabled_invalid_schema",
        descriptor: expect.objectContaining({ id: "plugin.echo.invalid" }),
      }),
    );
  });
});
