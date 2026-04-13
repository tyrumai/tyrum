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

  it("suggests exact direct schedule action overrides", () => {
    expect(
      suggestedOverridesForToolCall({
        toolId: "tool.automation.schedule.pause",
        matchTarget: "schedule_id:11111111-1111-1111-1111-111111111111",
        workspaceId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toEqual([
      {
        tool_id: "tool.automation.schedule.pause",
        pattern: "schedule_id:11111111-1111-1111-1111-111111111111",
        workspace_id: "11111111-1111-4111-8111-111111111111",
      },
    ]);
  });
});
