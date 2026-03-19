// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { createStore } from "../../../operator-core/src/store.js";
import { RunsPage } from "../../src/components/pages/runs-page.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

describe("RunsPage (artifacts)", () => {
  it("shows Desktop artifacts and previews screenshot + a11y tree", async () => {
    const runId = "11111111-1111-1111-1111-111111111111";
    const stepId = "22222222-2222-2222-2222-222222222222";
    const attemptId = "33333333-3333-3333-3333-333333333333";
    const screenshotArtifactId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const treeArtifactId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

    const run = {
      run_id: runId,
      job_id: "44444444-4444-4444-4444-444444444444",
      key: "key-1",
      lane: "main",
      status: "succeeded",
      attempt: 1,
      created_at: "2026-01-01T00:00:00.000Z",
      started_at: "2026-01-01T00:00:00.000Z",
      finished_at: "2026-01-01T00:00:01.000Z",
    } as const;

    const step = {
      step_id: stepId,
      run_id: runId,
      step_index: 0,
      status: "succeeded",
      action: { type: "Desktop", args: {} },
      created_at: "2026-01-01T00:00:00.000Z",
    } as const;

    const screenshotArtifact = {
      artifact_id: screenshotArtifactId,
      uri: `artifact://${screenshotArtifactId}`,
      kind: "screenshot",
      created_at: "2026-01-01T00:00:00.000Z",
      mime_type: "image/png",
      labels: ["screenshot", "desktop"],
    } as const;

    const treeArtifact = {
      artifact_id: treeArtifactId,
      uri: `artifact://${treeArtifactId}`,
      kind: "dom_snapshot",
      created_at: "2026-01-01T00:00:00.000Z",
      mime_type: "application/json",
      labels: ["a11y-tree", "desktop"],
    } as const;

    const attempt = {
      attempt_id: attemptId,
      step_id: stepId,
      attempt: 1,
      status: "succeeded",
      started_at: "2026-01-01T00:00:00.000Z",
      finished_at: "2026-01-01T00:00:01.000Z",
      error: null,
      artifacts: [screenshotArtifact, treeArtifact],
    } as const;

    const { store: runsStore } = createStore({
      runsById: { [runId]: run },
      stepsById: { [stepId]: step },
      attemptsById: { [attemptId]: attempt },
      stepIdsByRunId: { [runId]: [stepId] },
      attemptIdsByStepId: { [stepId]: [attemptId] },
    });

    const getBytes = vi.fn(async (artifactId: string) => {
      if (artifactId === screenshotArtifactId) {
        return { kind: "bytes", bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" };
      }
      const treeJson = JSON.stringify({
        root: {
          role: "window",
          name: "root",
          states: [],
          bounds: { x: 0, y: 0, width: 1, height: 1 },
          actions: [],
          children: [],
        },
      });
      return {
        kind: "bytes",
        bytes: new TextEncoder().encode(treeJson),
        contentType: "application/json",
      };
    });

    const getMetadata = vi.fn(async (artifactId: string) => {
      return {
        artifact: artifactId === screenshotArtifactId ? screenshotArtifact : treeArtifact,
        scope: {
          workspace_id: "default",
          agent_id: null,
          run_id: runId,
          step_id: stepId,
          attempt_id: attemptId,
          sensitivity: "sensitive",
          policy_snapshot_id: null,
        },
      };
    });

    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    const createObjectUrl = vi.fn(() => "blob:artifact-preview");
    const revokeObjectUrl = vi.fn();
    // jsdom: URL.createObjectURL may be missing
    URL.createObjectURL = createObjectUrl;
    URL.revokeObjectURL = revokeObjectUrl;

    const core = {
      runsStore,
      httpBaseUrl: "http://example.test",
      http: {
        artifacts: {
          getBytes,
          getMetadata,
        },
      },
    } as unknown as OperatorCore;

    const { container, root } = renderIntoDocument(React.createElement(RunsPage, { core }));

    try {
      const toggle = container.querySelector<HTMLButtonElement>(
        `[data-testid="run-toggle-${runId}"]`,
      );
      expect(toggle).not.toBeNull();

      act(() => {
        toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      const artifactsButton = container.querySelector<HTMLButtonElement>(
        `[data-testid="attempt-artifacts-${attemptId}"]`,
      );
      expect(artifactsButton).not.toBeNull();

      await act(async () => {
        artifactsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      const dialog = document.body.querySelector(
        `[data-testid="attempt-artifacts-dialog-${attemptId}"]`,
      );
      expect(dialog).not.toBeNull();

      await act(async () => {
        await Promise.resolve();
      });

      const img = document.body.querySelector<HTMLImageElement>(
        `[data-testid="artifact-preview-image-${screenshotArtifactId}"]`,
      );
      expect(img).not.toBeNull();
      expect(img?.getAttribute("src")).toBe("blob:artifact-preview");

      const jsonPreview = document.body.querySelector<HTMLDivElement>(
        `[data-testid="artifact-preview-json-${treeArtifactId}"]`,
      );
      expect(jsonPreview).not.toBeNull();
      expect(jsonPreview?.textContent).toContain("window");
    } finally {
      URL.createObjectURL = originalCreateObjectUrl;
      URL.revokeObjectURL = originalRevokeObjectUrl;
      cleanupTestRoot({ container, root });
    }
  });

  it("sanitizes redirect artifact URLs", async () => {
    const runId = "11111111-1111-1111-1111-111111111111";
    const stepId = "22222222-2222-2222-2222-222222222222";
    const attemptId = "33333333-3333-3333-3333-333333333333";
    const artifactId = "cccccccc-cccc-cccc-cccc-cccccccccccc";

    const run = {
      run_id: runId,
      job_id: "44444444-4444-4444-4444-444444444444",
      key: "key-1",
      lane: "main",
      status: "succeeded",
      attempt: 1,
      created_at: "2026-01-01T00:00:00.000Z",
      started_at: "2026-01-01T00:00:00.000Z",
      finished_at: "2026-01-01T00:00:01.000Z",
    } as const;

    const step = {
      step_id: stepId,
      run_id: runId,
      step_index: 0,
      status: "succeeded",
      action: { type: "Desktop", args: {} },
      created_at: "2026-01-01T00:00:00.000Z",
    } as const;

    const artifact = {
      artifact_id: artifactId,
      uri: `artifact://${artifactId}`,
      kind: "file",
      created_at: "2026-01-01T00:00:00.000Z",
      mime_type: "text/plain",
      labels: ["redirect"],
    } as const;

    const attempt = {
      attempt_id: attemptId,
      step_id: stepId,
      attempt: 1,
      status: "succeeded",
      started_at: "2026-01-01T00:00:00.000Z",
      finished_at: "2026-01-01T00:00:01.000Z",
      error: null,
      artifacts: [artifact],
    } as const;

    const { store: runsStore } = createStore({
      runsById: { [runId]: run },
      stepsById: { [stepId]: step },
      attemptsById: { [attemptId]: attempt },
      stepIdsByRunId: { [runId]: [stepId] },
      attemptIdsByStepId: { [stepId]: [attemptId] },
    });

    const getBytes = vi.fn(async () => {
      return { kind: "redirect", url: "javascript:alert(1)" } as const;
    });

    const getMetadata = vi.fn(async () => {
      return {
        artifact,
        scope: {
          workspace_id: "default",
          agent_id: null,
          run_id: runId,
          step_id: stepId,
          attempt_id: attemptId,
          sensitivity: "sensitive",
          policy_snapshot_id: null,
        },
      };
    });

    const core = {
      runsStore,
      httpBaseUrl: "http://example.test",
      http: {
        artifacts: {
          getBytes,
          getMetadata,
        },
      },
    } as unknown as OperatorCore;

    const { container, root } = renderIntoDocument(React.createElement(RunsPage, { core }));

    try {
      const toggle = container.querySelector<HTMLButtonElement>(
        `[data-testid="run-toggle-${runId}"]`,
      );
      expect(toggle).not.toBeNull();

      act(() => {
        toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      const artifactsButton = container.querySelector<HTMLButtonElement>(
        `[data-testid="attempt-artifacts-${attemptId}"]`,
      );
      expect(artifactsButton).not.toBeNull();

      await act(async () => {
        artifactsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      const dialog = document.body.querySelector(
        `[data-testid="attempt-artifacts-dialog-${attemptId}"]`,
      );
      expect(dialog).not.toBeNull();

      await act(async () => {
        await Promise.resolve();
      });

      const link = document.body.querySelector<HTMLAnchorElement>("a");
      expect(link).not.toBeNull();
      expect(link?.getAttribute("href")).toBe(`http://example.test/a/${artifactId}`);
    } finally {
      cleanupTestRoot({ container, root });
    }
  });
});
