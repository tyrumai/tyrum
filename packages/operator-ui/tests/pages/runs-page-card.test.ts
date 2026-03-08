// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React from "react";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { RunsPageCard } from "../../src/components/pages/runs-page-card.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

function createCore(): OperatorCore {
  return {
    http: {},
    httpBaseUrl: "http://example.test",
  } as unknown as OperatorCore;
}

describe("RunsPageCard", () => {
  it("renders full IDs with wrap-safe styling instead of truncating them", () => {
    const run = {
      run_id: "run-12345678-1234-5678-1234-567812345678",
      job_id: "job-12345678-1234-5678-1234-567812345678",
      key: "demo-run",
      lane: "main",
      status: "running",
      attempt: 1,
      created_at: "2026-01-01T00:00:00.000Z",
      started_at: "2026-01-01T00:00:01.000Z",
      finished_at: null,
    } as const;
    const step = {
      step_id: "step-12345678-1234-5678-1234-567812345678",
      run_id: run.run_id,
      step_index: 1,
      status: "running",
      action: {
        type: "very.long.action.identifier.that.should.wrap.cleanly.inside.the.timeline",
        args: {},
      },
      created_at: "2026-01-01T00:00:02.000Z",
    } as const;
    const attempt = {
      attempt_id: "attempt-12345678-1234-5678-1234-567812345678",
      step_id: step.step_id,
      attempt: 1,
      status: "timed_out",
      started_at: "2026-01-01T00:00:03.000Z",
      finished_at: "2026-01-01T00:00:05.000Z",
      error: "timeout",
      artifacts: [],
    } as const;

    const testRoot = renderIntoDocument(
      React.createElement(RunsPageCard, {
        core: createCore(),
        run,
        isExpanded: true,
        onToggleRun: vi.fn(),
        timeline: [{ step, attempts: [attempt] }],
      }),
    );

    try {
      const runCopy = testRoot.container.querySelector<HTMLButtonElement>(
        `[data-testid="copy-id-${run.run_id}"]`,
      );
      const stepCopy = testRoot.container.querySelector<HTMLButtonElement>(
        `[data-testid="copy-id-${step.step_id}"]`,
      );
      const attemptCopy = testRoot.container.querySelector<HTMLButtonElement>(
        `[data-testid="copy-id-${attempt.attempt_id}"]`,
      );

      expect(runCopy?.textContent).toBe(run.run_id);
      expect(stepCopy?.textContent).toBe(step.step_id);
      expect(attemptCopy?.textContent).toBe(attempt.attempt_id);
      expect(runCopy?.className).toContain("break-all");
      expect(stepCopy?.className).toContain("break-all");
      expect(attemptCopy?.className).toContain("break-all");
      expect(testRoot.container.textContent).toContain(step.action.type);
      expect(testRoot.container.textContent).toContain("timed out");
    } finally {
      cleanupTestRoot(testRoot);
    }
  });
});
