// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React, { act } from "react";
import { AgentsPage } from "../../src/components/pages/agents-page.js";
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
});
