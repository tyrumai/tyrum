import { describe, expect, it } from "vitest";
import { suggestedOverridesForToolCall } from "@tyrum/runtime-policy";

describe("suggestedOverridesForToolCall", () => {
  it("suggests exact heartbeat schedule creation overrides", () => {
    expect(
      suggestedOverridesForToolCall({
        toolId: "tool.automation.schedule.create",
        matchTarget: "kind:heartbeat;execution:agent_turn;delivery:quiet",
        workspaceId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toEqual([
      {
        tool_id: "tool.automation.schedule.create",
        pattern: "kind:heartbeat;execution:agent_turn;delivery:quiet",
        workspace_id: "11111111-1111-4111-8111-111111111111",
      },
    ]);
  });

  it("omits schedule create suggestions for custom step schedules", () => {
    expect(
      suggestedOverridesForToolCall({
        toolId: "tool.automation.schedule.create",
        matchTarget: "kind:cron;execution:steps;delivery:notify",
        workspaceId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toBeUndefined();
  });

  it("returns undefined for blank match targets", () => {
    expect(
      suggestedOverridesForToolCall({
        toolId: "tool.desktop.act",
        matchTarget: "   ",
        workspaceId: "workspace-1",
      }),
    ).toBeUndefined();
  });

  it("returns undefined for unsafe patterns", () => {
    expect(
      suggestedOverridesForToolCall({
        toolId: "tool.desktop.act",
        matchTarget: "echo *",
        workspaceId: "workspace-1",
      }),
    ).toBeUndefined();
  });
});
