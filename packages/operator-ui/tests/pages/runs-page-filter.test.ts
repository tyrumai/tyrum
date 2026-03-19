// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React from "react";
import type { OperatorCore } from "../../../operator-app/src/index.js";
import { createStore } from "../../../operator-app/src/store.js";
import { RunsPage } from "../../src/components/pages/runs-page.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("RunsPage", () => {
  it("filters runs by agent key when an agentId is provided", () => {
    const matchingRun = {
      run_id: "11111111-1111-1111-1111-111111111111",
      job_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      key: "agent:default:main",
      lane: "main",
      status: "running",
      attempt: 1,
      created_at: "2026-01-02T00:00:00.000Z",
      started_at: "2026-01-02T00:00:01.000Z",
      finished_at: null,
    } as const;
    const otherRun = {
      run_id: "22222222-2222-2222-2222-222222222222",
      job_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      key: "agent:agent-2:main",
      lane: "main",
      status: "queued",
      attempt: 1,
      created_at: "2026-01-01T00:00:00.000Z",
      started_at: null,
      finished_at: null,
    } as const;

    const { store: runsStore } = createStore({
      runsById: {
        [matchingRun.run_id]: matchingRun,
        [otherRun.run_id]: otherRun,
      },
      stepsById: {},
      attemptsById: {},
      stepIdsByRunId: {},
      attemptIdsByStepId: {},
    });

    const core = { runsStore } as unknown as OperatorCore;
    const testRoot = renderIntoDocument(
      React.createElement(RunsPage, { core, agentId: "default", embedded: true }),
    );

    expect(
      testRoot.container.querySelector(`[data-testid="run-status-${matchingRun.run_id}"]`),
    ).not.toBeNull();
    expect(
      testRoot.container.querySelector(`[data-testid="run-status-${otherRun.run_id}"]`),
    ).toBeNull();

    cleanupTestRoot(testRoot);
  });

  it("uses hydrated agent ownership for heartbeat runs without an agent-shaped key", () => {
    const heartbeatRun = {
      run_id: "33333333-3333-3333-3333-333333333333",
      job_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      key: "cron:watcher-1",
      lane: "heartbeat",
      status: "running",
      attempt: 1,
      created_at: "2026-01-03T00:00:00.000Z",
      started_at: "2026-01-03T00:00:01.000Z",
      finished_at: null,
    } as const;

    const { store: runsStore } = createStore({
      runsById: {
        [heartbeatRun.run_id]: heartbeatRun,
      },
      stepsById: {},
      attemptsById: {},
      stepIdsByRunId: {},
      attemptIdsByStepId: {},
      agentKeyByRunId: {
        [heartbeatRun.run_id]: "default",
      },
    });

    const core = { runsStore } as unknown as OperatorCore;
    const testRoot = renderIntoDocument(
      React.createElement(RunsPage, { core, agentId: "default", embedded: true }),
    );

    expect(
      testRoot.container.querySelector(`[data-testid="run-status-${heartbeatRun.run_id}"]`),
    ).not.toBeNull();

    cleanupTestRoot(testRoot);
  });
});
