import { describe, expect, it } from "vitest";

import {
  getActiveAgentIdsFromSessionLanes,
  getActiveExecutionRunsCountFromQueueDepth,
  parseAgentIdFromKey,
} from "../../src/lib/status-session-lanes.js";

describe("status-session-lanes", () => {
  it("parses agent ids from agent run keys", () => {
    expect(parseAgentIdFromKey("agent:default:ui:main")).toBe("default");
    expect(parseAgentIdFromKey("agent:secondary:ui")).toBe("secondary");
    expect(parseAgentIdFromKey("agent:default:")).toBe("default");

    expect(parseAgentIdFromKey("agent::ui")).toBeNull();
    expect(parseAgentIdFromKey("agent:default")).toBeNull();
    expect(parseAgentIdFromKey("not-agent")).toBeNull();
  });

  it("extracts active agent ids from session lanes", () => {
    const ids = getActiveAgentIdsFromSessionLanes([
      { key: "agent:default:ui:main", latest_run_status: "running", queued_runs: 0 },
      { key: "agent:secondary:ui:main", latest_run_status: null, queued_runs: 2 },
      { key: "not-agent", latest_run_status: "running", queued_runs: 1 },
    ]);

    expect(Array.from(ids).toSorted()).toEqual(["default", "secondary"]);
  });

  it("extracts execution run counts from queue depth", () => {
    expect(
      getActiveExecutionRunsCountFromQueueDepth({
        execution_runs: { queued: 2, running: 1, paused: 3 },
      }),
    ).toBe(6);

    expect(
      getActiveExecutionRunsCountFromQueueDepth({
        execution_runs: { queued: "2", running: "1", paused: "0" },
      }),
    ).toBe(3);

    expect(getActiveExecutionRunsCountFromQueueDepth(null)).toBeNull();
    expect(getActiveExecutionRunsCountFromQueueDepth({})).toBeNull();
  });
});
