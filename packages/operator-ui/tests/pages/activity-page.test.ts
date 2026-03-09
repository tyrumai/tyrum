// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React, { act } from "react";
import type { ActivityState } from "../../../operator-core/src/stores/activity-store.js";
import { createStore } from "../../../operator-core/src/store.js";
import { ActivityPage } from "../../src/components/pages/activity-page.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

function createActivityState(overrides: Partial<ActivityState> = {}): ActivityState {
  return {
    agentsById: {},
    agentIds: [],
    workstreamsById: {},
    workstreamIds: [],
    selectedAgentId: null,
    selectedWorkstreamId: null,
    ...overrides,
  };
}

function createCore(
  overrides: {
    activity?: Partial<ActivityState>;
    statusLoading?: boolean;
  } = {},
) {
  const { store: statusStore } = createStore({
    status: null,
    usage: null,
    presenceByInstanceId: {},
    loading: {
      status: overrides.statusLoading ?? false,
      usage: false,
      presence: false,
    },
    error: { status: null, usage: null, presence: null },
    lastSyncedAt: null,
  });
  const activityState = createActivityState(overrides.activity);
  const activity = createStore(activityState);
  const activityStore = {
    ...activity.store,
    clearSelection() {
      activity.setState((prev) => ({ ...prev, selectedWorkstreamId: null }));
    },
    selectWorkstream(workstreamId: string | null) {
      activity.setState((prev) => ({ ...prev, selectedWorkstreamId: workstreamId }));
    },
  };

  return {
    activityStore,
    statusStore,
  };
}

describe("ActivityPage", () => {
  it("renders a stable empty shell with filter, scene, inspector, and timeline regions", () => {
    const core = createCore();
    const testRoot = renderIntoDocument(React.createElement(ActivityPage, { core: core as never }));

    expect(testRoot.container.querySelector('[data-testid="activity-page"]')).not.toBeNull();
    expect(
      testRoot.container.querySelector('[data-testid="activity-page-filters"]'),
    ).not.toBeNull();
    expect(testRoot.container.querySelector('[data-testid="activity-page-scene"]')).not.toBeNull();
    expect(
      testRoot.container.querySelector('[data-testid="activity-page-inspector"]'),
    ).not.toBeNull();
    expect(
      testRoot.container.querySelector('[data-testid="activity-page-timeline"]'),
    ).not.toBeNull();
    expect(testRoot.container.textContent).toContain("Scene coming online");
    expect(testRoot.container.textContent).toContain("No workstream selected");

    cleanupTestRoot(testRoot);
  });

  it("renders loading placeholders before the first activity snapshot is ready", () => {
    const core = createCore({ statusLoading: true });
    const testRoot = renderIntoDocument(React.createElement(ActivityPage, { core: core as never }));

    expect(
      testRoot.container.querySelector('[data-testid="activity-page-loading"]'),
    ).not.toBeNull();
    expect(testRoot.container.textContent).toContain("Preparing activity scene");

    cleanupTestRoot(testRoot);
  });

  it("renders the selected workstream and recent events, and lets the operator switch focus", () => {
    const core = createCore({
      activity: {
        agentIds: ["alpha"],
        agentsById: {
          alpha: {
            agentId: "alpha",
            persona: {
              name: "Alpha",
              description: "Primary operator",
              tone: "direct",
              palette: "graphite",
              character: "operator",
            },
            workstreamIds: ["agent:alpha:main::main", "agent:alpha:main::review"],
            selectedWorkstreamId: "agent:alpha:main::main",
          },
        },
        workstreamIds: ["agent:alpha:main::main", "agent:alpha:main::review"],
        selectedAgentId: "alpha",
        selectedWorkstreamId: "agent:alpha:main::main",
        workstreamsById: {
          "agent:alpha:main::main": {
            id: "agent:alpha:main::main",
            key: "agent:alpha:main",
            lane: "main",
            agentId: "alpha",
            persona: {
              name: "Alpha",
              description: "Primary operator",
              tone: "direct",
              palette: "graphite",
              character: "operator",
            },
            latestRunId: "run-1",
            runStatus: "running",
            queuedRunCount: 1,
            lease: { owner: "Alpha", expiresAtMs: null, active: true },
            attentionLevel: "high",
            attentionScore: 78,
            currentRoom: "strategy-desk",
            bubbleText: "Planning the next move",
            recentEvents: [
              {
                id: "evt-1",
                type: "message.delta",
                occurredAt: "2026-03-09T09:00:00.000Z",
                summary: "Planning the next move",
              },
            ],
          },
          "agent:alpha:main::review": {
            id: "agent:alpha:main::review",
            key: "agent:alpha:main",
            lane: "review",
            agentId: "alpha",
            persona: {
              name: "Alpha",
              description: "Primary operator",
              tone: "direct",
              palette: "graphite",
              character: "operator",
            },
            latestRunId: "run-2",
            runStatus: "paused",
            queuedRunCount: 0,
            lease: { owner: null, expiresAtMs: null, active: false },
            attentionLevel: "medium",
            attentionScore: 42,
            currentRoom: "approval-desk",
            bubbleText: "Waiting for review",
            recentEvents: [
              {
                id: "evt-2",
                type: "approval.updated",
                occurredAt: "2026-03-09T09:05:00.000Z",
                summary: "Waiting for review",
              },
            ],
          },
        },
      },
    });

    const testRoot = renderIntoDocument(React.createElement(ActivityPage, { core: core as never }));

    expect(testRoot.container.textContent).toContain("Planning the next move");
    expect(testRoot.container.textContent).toContain("Strategy desk");
    expect(testRoot.container.textContent).toContain("run-1");

    const reviewButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="activity-workstream-agent:alpha:main::review"]',
    );
    expect(reviewButton).not.toBeNull();

    act(() => {
      reviewButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(testRoot.container.textContent).toContain("Waiting for review");
    expect(testRoot.container.textContent).toContain("Approval desk");
    expect(testRoot.container.textContent).toContain("run-2");

    cleanupTestRoot(testRoot);
  });
});
