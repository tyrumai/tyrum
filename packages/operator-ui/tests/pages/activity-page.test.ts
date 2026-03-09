// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import type { ActivityState } from "../../../operator-core/src/stores/activity-store.js";
import { createStore } from "../../../operator-core/src/store.js";
import { ActivityPage } from "../../src/components/pages/activity-page.js";
import { cleanupTestRoot, renderIntoDocument, stubMatchMedia } from "../test-utils.js";

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

function createPersona(name: string) {
  return {
    name,
    description: `${name} operator persona`,
    tone: "direct" as const,
    palette: "graphite" as const,
    character: "operator" as const,
  };
}

function createWorkstream(
  overrides: Partial<ActivityState["workstreamsById"][string]> & {
    id: string;
    key: string;
    lane: string;
    agentId: string;
    currentRoom: NonNullable<ActivityState["workstreamsById"][string]>["currentRoom"];
  },
) {
  const persona = createPersona(overrides.agentId === "alpha" ? "Alpha" : "Beta");
  return {
    id: overrides.id,
    key: overrides.key,
    lane: overrides.lane,
    agentId: overrides.agentId,
    persona,
    latestRunId: overrides.latestRunId ?? null,
    runStatus: overrides.runStatus ?? null,
    queuedRunCount: overrides.queuedRunCount ?? 0,
    lease: overrides.lease ?? { owner: null, expiresAtMs: null, active: false },
    attentionLevel: overrides.attentionLevel ?? "low",
    attentionScore: overrides.attentionScore ?? 20,
    currentRoom: overrides.currentRoom,
    bubbleText: overrides.bubbleText ?? null,
    recentEvents: overrides.recentEvents ?? [],
  };
}

function createSampleActivityState(): ActivityState {
  const main = createWorkstream({
    id: "agent:alpha:main::main",
    key: "agent:alpha:main",
    lane: "main",
    agentId: "alpha",
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
  });
  const review = createWorkstream({
    id: "agent:alpha:main::review",
    key: "agent:alpha:main",
    lane: "review",
    agentId: "alpha",
    latestRunId: "run-2",
    runStatus: "paused",
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
  });
  return {
    agentIds: ["alpha"],
    agentsById: {
      alpha: {
        agentId: "alpha",
        persona: createPersona("Alpha"),
        workstreamIds: [main.id, review.id],
        selectedWorkstreamId: main.id,
      },
    },
    workstreamIds: [main.id, review.id],
    selectedAgentId: "alpha",
    selectedWorkstreamId: main.id,
    workstreamsById: {
      [main.id]: main,
      [review.id]: review,
    },
  };
}

describe("ActivityPage", () => {
  afterEach(() => {
    delete (document as Document & { visibilityState?: string }).visibilityState;
  });

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
      activity: createSampleActivityState(),
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

  it("keeps the all-workstreams cleared state instead of snapping back to the first stream", () => {
    const core = createCore({
      activity: createSampleActivityState(),
    });

    const testRoot = renderIntoDocument(React.createElement(ActivityPage, { core: core as never }));

    const clearButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="activity-page-filters"] button',
    );
    expect(clearButton).not.toBeNull();

    act(() => {
      clearButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(clearButton?.getAttribute("aria-pressed")).toBe("true");
    expect(testRoot.container.textContent).toContain("No workstream selected");
    expect(testRoot.container.textContent).toContain("Planning the next move");
    expect(testRoot.container.textContent).toContain("Waiting for review");
    expect(testRoot.container.textContent).not.toContain("run-1");

    cleanupTestRoot(testRoot);
  });

  it("renders the fixed building rooms and switches to reduced motion when requested", () => {
    const reducedMotion = stubMatchMedia("(prefers-reduced-motion: reduce)", true);
    const core = createCore({ activity: createSampleActivityState() });

    const testRoot = renderIntoDocument(React.createElement(ActivityPage, { core: core as never }));

    const viewport = testRoot.container.querySelector<HTMLElement>(
      '[data-testid="activity-scene-viewport"]',
    );
    expect(viewport?.dataset.motionMode).toBe("reduced");
    expect(testRoot.container.textContent).toContain("Lounge");
    expect(testRoot.container.textContent).toContain("Strategy desk");
    expect(testRoot.container.textContent).toContain("Library");
    expect(testRoot.container.textContent).toContain("Terminal lab");
    expect(testRoot.container.textContent).toContain("Archive");
    expect(testRoot.container.textContent).toContain("Mail room");
    expect(testRoot.container.textContent).toContain("Approval desk");

    cleanupTestRoot(testRoot);
    reducedMotion.cleanup();
  });

  it("suspends motion when the document becomes hidden", () => {
    const reducedMotion = stubMatchMedia("(prefers-reduced-motion: reduce)", false);
    const core = createCore({ activity: createSampleActivityState() });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });

    const testRoot = renderIntoDocument(React.createElement(ActivityPage, { core: core as never }));
    const viewport = testRoot.container.querySelector<HTMLElement>(
      '[data-testid="activity-scene-viewport"]',
    );
    expect(viewport?.dataset.visibilityState).toBe("visible");

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(viewport?.dataset.visibilityState).toBe("hidden");

    cleanupTestRoot(testRoot);
    reducedMotion.cleanup();
  });

  it("does not restart idle animations when selection changes without changing scene topology", () => {
    const reducedMotion = stubMatchMedia("(prefers-reduced-motion: reduce)", false);
    const originalAnimate = HTMLElement.prototype.animate;
    const originalGetAnimations = HTMLElement.prototype.getAnimations;
    const cancel = vi.fn();
    const animate = vi.fn(() => ({ cancel }) as unknown as Animation);

    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      value: animate,
    });
    Object.defineProperty(HTMLElement.prototype, "getAnimations", {
      configurable: true,
      value: () => [],
    });

    try {
      const core = createCore({ activity: createSampleActivityState() });
      const testRoot = renderIntoDocument(
        React.createElement(ActivityPage, { core: core as never }),
      );

      const initialAnimateCalls = animate.mock.calls.length;
      expect(initialAnimateCalls).toBeGreaterThan(0);

      const reviewButton = testRoot.container.querySelector<HTMLButtonElement>(
        '[data-testid="activity-workstream-agent:alpha:main::review"]',
      );
      expect(reviewButton).not.toBeNull();

      act(() => {
        reviewButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(animate).toHaveBeenCalledTimes(initialAnimateCalls);

      cleanupTestRoot(testRoot);
    } finally {
      if (originalAnimate) {
        Object.defineProperty(HTMLElement.prototype, "animate", {
          configurable: true,
          value: originalAnimate,
        });
      } else {
        delete (HTMLElement.prototype as Partial<typeof HTMLElement.prototype>).animate;
      }
      if (originalGetAnimations) {
        Object.defineProperty(HTMLElement.prototype, "getAnimations", {
          configurable: true,
          value: originalGetAnimations,
        });
      } else {
        delete (HTMLElement.prototype as Partial<typeof HTMLElement.prototype>).getAnimations;
      }
      reducedMotion.cleanup();
    }
  });
});
