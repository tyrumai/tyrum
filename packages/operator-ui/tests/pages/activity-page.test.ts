// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { AgentConfig } from "@tyrum/schemas";
import { ActivityPage } from "../../src/components/pages/activity-page.js";
import {
  createCore,
  createSampleActivityState,
  flushActivityPage,
  sampleAgentConfigUpdateResponse,
  sampleManagedAgentDetail,
} from "./activity-page-test-support.js";
import { cleanupTestRoot, renderIntoDocument, stubMatchMedia } from "../test-utils.js";

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

  it("shows agent-level workstream tabs and labeled persona editor controls", async () => {
    const getAgent = vi.fn().mockResolvedValue(sampleManagedAgentDetail("alpha"));
    const core = createCore({
      activity: createSampleActivityState(),
      getAgent,
    });

    const testRoot = renderIntoDocument(React.createElement(ActivityPage, { core: core as never }));
    await flushActivityPage();

    expect(getAgent).toHaveBeenCalledWith("alpha");
    expect(testRoot.container.textContent).toContain("Agent identity");

    const mainTab = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="activity-inspector-workstream-agent:alpha:main::main"]',
    );
    const reviewTab = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="activity-inspector-workstream-agent:alpha:main::review"]',
    );
    const nameInput = testRoot.container.querySelector<HTMLInputElement>(
      '[data-testid="activity-persona-name"]',
    );
    const descriptionInput = testRoot.container.querySelector<HTMLTextAreaElement>(
      '[data-testid="activity-persona-description"]',
    );
    const toneInput = testRoot.container.querySelector<HTMLInputElement>(
      '[data-testid="activity-persona-tone"]',
    );
    const paletteInput = testRoot.container.querySelector<HTMLInputElement>(
      '[data-testid="activity-persona-palette"]',
    );
    const characterInput = testRoot.container.querySelector<HTMLInputElement>(
      '[data-testid="activity-persona-character"]',
    );

    expect(mainTab?.getAttribute("aria-pressed")).toBe("true");
    expect(reviewTab?.getAttribute("aria-pressed")).toBe("false");
    expect(mainTab?.textContent).toBe("Main · alpha:main");
    expect(reviewTab?.textContent).toBe("Review · alpha:main");
    expect(nameInput?.value).toBe("Alpha");
    expect(descriptionInput?.value).toBe("Alpha operator persona");
    expect(toneInput?.value).toBe("direct");
    expect(paletteInput?.value).toBe("graphite");
    expect(characterInput?.value).toBe("operator");

    for (const control of [nameInput, descriptionInput, toneInput, paletteInput, characterInput]) {
      expect(control).not.toBeNull();
      expect(control?.id).toBeTruthy();
      expect(testRoot.container.querySelector(`label[for="${control?.id}"]`)).not.toBeNull();
    }

    act(() => {
      reviewTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(reviewTab?.getAttribute("aria-pressed")).toBe("true");
    expect(testRoot.container.textContent).toContain("Waiting for review");

    cleanupTestRoot(testRoot);
  });

  it("randomizes the persona preview and saves the persisted config revision with an audit reason", async () => {
    const updateAgentConfig = vi.fn().mockResolvedValue({
      ...sampleAgentConfigUpdateResponse("alpha"),
      revision: 7,
      config: AgentConfig.parse({
        model: { model: "openai/gpt-5.4" },
        persona: {
          name: "Euclid",
          description: "Autonomous navigator with a curious tone.",
          tone: "curious",
          palette: "ocean",
          character: "navigator",
        },
      }),
      persona: {
        name: "Euclid",
        description: "Autonomous navigator with a curious tone.",
        tone: "curious",
        palette: "ocean",
        character: "navigator",
      },
    });
    const core = createCore({
      activity: createSampleActivityState(),
      updateAgentConfig,
    });

    const testRoot = renderIntoDocument(React.createElement(ActivityPage, { core: core as never }));
    await flushActivityPage();

    const randomizeButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="activity-persona-randomize"]',
    );
    const saveButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="activity-persona-save"]',
    );
    const nameInput = testRoot.container.querySelector<HTMLInputElement>(
      '[data-testid="activity-persona-name"]',
    );

    expect(randomizeButton).not.toBeNull();
    expect(saveButton).not.toBeNull();

    await act(async () => {
      randomizeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const previewName = nameInput?.value ?? "";
    const toneInput = testRoot.container.querySelector<HTMLInputElement>(
      '[data-testid="activity-persona-tone"]',
    );
    const paletteInput = testRoot.container.querySelector<HTMLInputElement>(
      '[data-testid="activity-persona-palette"]',
    );
    const characterInput = testRoot.container.querySelector<HTMLInputElement>(
      '[data-testid="activity-persona-character"]',
    );

    expect(previewName).toBe("Euclid");
    expect(testRoot.container.textContent).toContain(previewName);

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(updateAgentConfig).toHaveBeenCalledWith(
      "alpha",
      expect.objectContaining({
        reason: "activity inspector persona update",
        config: expect.objectContaining({
          persona: expect.objectContaining({
            name: previewName,
            tone: toneInput?.value,
            palette: paletteInput?.value,
            character: characterInput?.value,
          }),
        }),
      }),
    );
    expect(testRoot.container.textContent).toContain("Saved as revision 7");

    cleanupTestRoot(testRoot);
  });

  it("surfaces save failures without discarding the previewed persona edits", async () => {
    const updateAgentConfig = vi.fn().mockRejectedValue(new Error("save exploded"));
    const core = createCore({
      activity: createSampleActivityState(),
      updateAgentConfig,
    });

    const testRoot = renderIntoDocument(React.createElement(ActivityPage, { core: core as never }));
    await flushActivityPage();

    const randomizeButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="activity-persona-randomize"]',
    );
    const saveButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="activity-persona-save"]',
    );

    expect(randomizeButton).not.toBeNull();
    expect(saveButton).not.toBeNull();

    await act(async () => {
      randomizeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const nameInput = testRoot.container.querySelector<HTMLInputElement>(
      '[data-testid="activity-persona-name"]',
    );
    const previewName = nameInput?.value ?? "";
    expect(previewName).toBe("Euclid");
    expect(testRoot.container.textContent).toContain(previewName);

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(testRoot.container.textContent).toContain("Save failed");
    expect(testRoot.container.textContent).toContain("save exploded");
    expect(nameInput?.value).toBe(previewName);

    cleanupTestRoot(testRoot);
  });

  it("falls back to read-only inspector persona details when managed config is unavailable", async () => {
    const getAgent = vi.fn().mockRejectedValue(new Error("agent 'alpha' not found"));
    const core = createCore({
      activity: createSampleActivityState(),
      getAgent,
    });

    const testRoot = renderIntoDocument(React.createElement(ActivityPage, { core: core as never }));
    await flushActivityPage();

    expect(testRoot.container.textContent).toContain("Managed persona config unavailable");
    expect(testRoot.container.textContent).toContain("Alpha");

    const randomizeButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="activity-persona-randomize"]',
    );
    const saveButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="activity-persona-save"]',
    );

    expect(randomizeButton?.disabled).toBe(true);
    expect(saveButton?.disabled).toBe(true);

    cleanupTestRoot(testRoot);
  });
});
