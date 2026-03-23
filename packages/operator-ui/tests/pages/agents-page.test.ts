// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { AgentsPage } from "../../src/components/pages/agents-page.js";
import { createDeferred } from "../operator-ui.test-support.js";
import { cleanupTestRoot, click, renderIntoDocument } from "../test-utils.js";
import { createCore, flush } from "./agents-page.test-support.tsx";

describe("AgentsPage", () => {
  it("loads managed agents and opens the latest retained root by default", async () => {
    const { core, transcriptStore, transcriptFixture } = createCore();

    const testRoot = renderIntoDocument(React.createElement(AgentsPage, { core }));
    await flush();

    expect(transcriptStore.refresh).toHaveBeenCalledTimes(1);
    expect(transcriptStore.openSession).toHaveBeenCalledWith(
      transcriptFixture.latestRootSession.session_key,
    );
    expect(testRoot.container.textContent).toContain("Latest retained transcript");
    expect(testRoot.container.textContent).toContain("Delegated child");

    const childRow = testRoot.container.querySelector<HTMLElement>(
      `[data-testid="agents-subagent-${transcriptFixture.childSession.session_key}"]`,
    );
    expect(childRow).not.toBeNull();
    expect(childRow?.parentElement?.style.marginLeft).toBe("18px");

    cleanupTestRoot(testRoot);
  });

  it("switches the selected agent lineage from the root picker", async () => {
    const { core, transcriptStore, transcriptFixture } = createCore();

    const testRoot = renderIntoDocument(React.createElement(AgentsPage, { core }));
    await flush();

    const rootPicker = testRoot.container.querySelector<HTMLSelectElement>(
      '[data-testid="agents-root-picker"]',
    );
    expect(rootPicker).not.toBeNull();

    await act(async () => {
      if (rootPicker) {
        rootPicker.value = transcriptFixture.olderRootSession.session_key;
        rootPicker.dispatchEvent(new Event("change", { bubbles: true }));
      }
      await Promise.resolve();
    });
    await flush();

    expect(transcriptStore.openSession).toHaveBeenLastCalledWith(
      transcriptFixture.olderRootSession.session_key,
    );
    expect(testRoot.container.textContent).toContain("Older retained transcript");
    expect(
      testRoot.container.querySelector(
        `[data-testid="agents-subagent-${transcriptFixture.childSession.session_key}"]`,
      ),
    ).toBeNull();

    cleanupTestRoot(testRoot);
  });

  it("stops a retained subagent from the tree", async () => {
    const { core, transcriptFixture } = createCore();

    const testRoot = renderIntoDocument(React.createElement(AgentsPage, { core }));
    await flush();

    const stopButton = testRoot.container.querySelector<HTMLButtonElement>(
      `[data-testid="agents-stop-${transcriptFixture.childSession.subagent_id}"]`,
    );
    expect(stopButton).not.toBeNull();

    await act(async () => {
      click(stopButton!);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(core.chatSocket.requestDynamic).toHaveBeenCalledWith(
      "subagent.close",
      expect.objectContaining({
        agent_key: "default",
        subagent_id: transcriptFixture.childSession.subagent_id,
      }),
      expect.anything(),
    );

    cleanupTestRoot(testRoot);
  });

  it("reopens the latest selected transcript after a stop finishes", async () => {
    const stopDeferred = createDeferred<{
      subagent: {
        subagent_id: string;
        tenant_id: string;
        agent_id: string;
        workspace_id: string;
        parent_session_key: string;
        session_key: string;
        execution_profile: string;
        lane: string;
        status: "closed";
        created_at: string;
        updated_at: string;
        closed_at: string;
      };
    }>();
    const subagentClose = vi.fn(() => stopDeferred.promise);
    const { core, transcriptStore, transcriptFixture } = createCore({ subagentClose });

    const testRoot = renderIntoDocument(React.createElement(AgentsPage, { core }));
    await flush();

    await act(async () => {
      click(
        testRoot.container.querySelector<HTMLElement>(
          `[data-testid="agents-stop-${transcriptFixture.childSession.subagent_id}"]`,
        )!,
      );
      await Promise.resolve();
    });

    await act(async () => {
      click(
        testRoot.container.querySelector<HTMLElement>('[data-testid="agents-select-agent-1"]')!,
      );
      await Promise.resolve();
    });
    await flush();

    expect(transcriptStore.openSession).toHaveBeenLastCalledWith(
      transcriptFixture.secondaryAgentRoot.session_key,
    );

    await act(async () => {
      stopDeferred.resolve({
        subagent: {
          subagent_id: transcriptFixture.childSession.subagent_id,
          tenant_id: "tenant-default",
          agent_id: "00000000-0000-4000-8000-000000000001",
          workspace_id: "00000000-0000-4000-8000-000000000002",
          parent_session_key: transcriptFixture.latestRootSession.session_key,
          session_key: transcriptFixture.childSession.session_key,
          execution_profile: "executor",
          lane: "subagent",
          status: "closed",
          created_at: "2026-03-09T00:01:00.000Z",
          updated_at: "2026-03-09T00:06:00.000Z",
          closed_at: "2026-03-09T00:06:00.000Z",
        },
      });
      await stopDeferred.promise;
    });
    await flush();

    expect(transcriptStore.openSession).toHaveBeenLastCalledWith(
      transcriptFixture.secondaryAgentRoot.session_key,
    );

    cleanupTestRoot(testRoot);
  });
});
