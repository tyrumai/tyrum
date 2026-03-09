// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { ActivityPage } from "../../src/components/pages/activity-page.js";
import { createCore, createSampleActivityState } from "./activity-page-test-support.js";
import { cleanupTestRoot, renderIntoDocument, stubMatchMedia } from "../test-utils.js";

describe("ActivityPage", () => {
  afterEach(() => {
    delete (document as Document & { visibilityState?: string }).visibilityState;
  });

  it("renders a stable empty shell with filter and scene regions", () => {
    const core = createCore();
    const testRoot = renderIntoDocument(React.createElement(ActivityPage, { core: core as never }));

    expect(testRoot.container.querySelector('[data-testid="activity-page"]')).not.toBeNull();
    expect(
      testRoot.container.querySelector('[data-testid="activity-page-filters"]'),
    ).not.toBeNull();
    expect(testRoot.container.querySelector('[data-testid="activity-page-scene"]')).not.toBeNull();
    expect(testRoot.container.textContent).toContain("Scene coming online");

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

  it("renders the selected workstream popover and timeline events", () => {
    const core = createCore({
      activity: createSampleActivityState(),
    });

    const testRoot = renderIntoDocument(React.createElement(ActivityPage, { core: core as never }));

    expect(testRoot.container.textContent).toContain("Planning the next move");
    expect(testRoot.container.textContent).toContain("Strategy desk");

    const reviewButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="activity-workstream-agent:alpha:main::review"]',
    );
    expect(reviewButton).not.toBeNull();

    act(() => {
      reviewButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(testRoot.container.textContent).toContain("Waiting for review");
    expect(testRoot.container.textContent).toContain("Approval desk");

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
    expect(testRoot.container.textContent).toContain("Planning the next move");
    expect(testRoot.container.textContent).toContain("Waiting for review");

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

  it("shows the actor popover with workstream details when a workstream is selected", () => {
    const core = createCore({
      activity: createSampleActivityState(),
    });

    const testRoot = renderIntoDocument(React.createElement(ActivityPage, { core: core as never }));

    const popover = testRoot.container.querySelector('[data-testid="activity-actor-popover"]');
    expect(popover).not.toBeNull();
    expect(popover?.textContent).toContain("Alpha");
    expect(popover?.textContent).toContain("Strategy desk");
    expect(popover?.textContent).toContain("Running");

    cleanupTestRoot(testRoot);
  });

  it("shows the timeline feed below the building scene", () => {
    const core = createCore({
      activity: createSampleActivityState(),
    });

    const testRoot = renderIntoDocument(React.createElement(ActivityPage, { core: core as never }));

    const timeline = testRoot.container.querySelector('[data-testid="activity-page-timeline"]');
    expect(timeline).not.toBeNull();
    expect(timeline?.textContent).toContain("Planning the next move");

    cleanupTestRoot(testRoot);
  });
});
