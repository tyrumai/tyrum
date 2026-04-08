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
    expect(transcriptStore.openConversation).toHaveBeenCalledWith(
      transcriptFixture.latestRootConversation.conversation_key,
    );
    expect(testRoot.container.textContent).toContain("Latest retained transcript");
    expect(testRoot.container.textContent).toContain("Delegated child");
    expect(
      testRoot.container.querySelector('[data-testid="transcript-event-message:latest:msg-1"]'),
    ).not.toBeNull();
    expect(testRoot.container.textContent).toContain("Inspect the latest transcript");
    expect(testRoot.container.textContent).toContain("websearch");
    expect(testRoot.container.textContent).toContain("Approve the next action?");
    expect(testRoot.container.textContent).toContain("tool.location.get");
    expect(testRoot.container.textContent).toContain("Context report");

    const latestRootRow = testRoot.container.querySelector<HTMLElement>(
      `[data-testid="agents-conversation-${transcriptFixture.latestRootConversation.conversation_key}"]`,
    );
    expect(latestRootRow).not.toBeNull();
    expect(latestRootRow?.parentElement?.style.marginLeft).toBe("18px");

    const childRow = testRoot.container.querySelector<HTMLElement>(
      `[data-testid="agents-conversation-${transcriptFixture.childConversation.conversation_key}"]`,
    );
    expect(childRow).not.toBeNull();
    expect(childRow?.parentElement?.style.marginLeft).toBe("36px");

    cleanupTestRoot(testRoot);
  });

  it("switches the selected agent lineage from the sidebar conversation tree", async () => {
    const { core, transcriptStore, transcriptFixture } = createCore();

    const testRoot = renderIntoDocument(React.createElement(AgentsPage, { core }));
    await flush();

    const olderRootRow = testRoot.container.querySelector<HTMLElement>(
      `[data-testid="agents-conversation-${transcriptFixture.olderRootConversation.conversation_key}"]`,
    );
    expect(olderRootRow).not.toBeNull();

    await act(async () => {
      click(olderRootRow!);
      await Promise.resolve();
    });
    await flush();

    expect(transcriptStore.openConversation).toHaveBeenLastCalledWith(
      transcriptFixture.olderRootConversation.conversation_key,
    );
    expect(testRoot.container.textContent).toContain("Older retained transcript");
    expect(
      testRoot.container.querySelector(
        `[data-testid="agents-conversation-${transcriptFixture.childConversation.conversation_key}"]`,
      ),
    ).not.toBeNull();

    cleanupTestRoot(testRoot);
  });

  it("shows selected transcript event details without an artifact section", async () => {
    const { core } = createCore();

    const testRoot = renderIntoDocument(React.createElement(AgentsPage, { core }));
    await flush();
    const selectedEvent = testRoot.container.querySelector<HTMLElement>(
      '[data-testid="transcript-event-message:latest:msg-1"]',
    );
    expect(selectedEvent).not.toBeNull();

    await act(async () => {
      click(selectedEvent!);
      await Promise.resolve();
    });
    await flush();

    expect(testRoot.container.textContent).toContain(
      "Raw details for the selected transcript event.",
    );
    expect(testRoot.container.textContent).not.toContain("Artifacts");
    expect(testRoot.container.textContent).toContain("Inspect the latest transcript");

    cleanupTestRoot(testRoot);
  });

  it("stops a retained subagent from the tree", async () => {
    const { core, transcriptFixture } = createCore();

    const testRoot = renderIntoDocument(React.createElement(AgentsPage, { core }));
    await flush();

    const stopButton = testRoot.container.querySelector<HTMLButtonElement>(
      `[data-testid="agents-stop-${transcriptFixture.childConversation.subagent_id}"]`,
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
        subagent_id: transcriptFixture.childConversation.subagent_id,
      }),
      expect.anything(),
    );

    cleanupTestRoot(testRoot);
  });

  it("switches active roots when selecting a child under another root", async () => {
    const { core, transcriptStore, transcriptFixture } = createCore();

    const testRoot = renderIntoDocument(React.createElement(AgentsPage, { core }));
    await flush();

    await act(async () => {
      click(
        testRoot.container.querySelector<HTMLElement>(
          `[data-testid="agents-conversation-${transcriptFixture.olderRootConversation.conversation_key}"]`,
        )!,
      );
      await Promise.resolve();
    });
    await flush();

    expect(transcriptStore.openConversation).toHaveBeenLastCalledWith(
      transcriptFixture.olderRootConversation.conversation_key,
    );

    await act(async () => {
      click(
        testRoot.container.querySelector<HTMLElement>(
          `[data-testid="agents-conversation-${transcriptFixture.childConversation.conversation_key}"]`,
        )!,
      );
      await Promise.resolve();
    });
    await flush();

    expect(transcriptStore.openConversation).toHaveBeenLastCalledWith(
      transcriptFixture.childConversation.conversation_key,
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
        parent_conversation_key: string;
        conversation_key: string;
        execution_profile: string;
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
          `[data-testid="agents-stop-${transcriptFixture.childConversation.subagent_id}"]`,
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

    expect(transcriptStore.openConversation).toHaveBeenLastCalledWith(
      transcriptFixture.secondaryAgentRoot.conversation_key,
    );

    await act(async () => {
      stopDeferred.resolve({
        subagent: {
          subagent_id: transcriptFixture.childConversation.subagent_id,
          tenant_id: "tenant-default",
          agent_id: "00000000-0000-4000-8000-000000000001",
          workspace_id: "00000000-0000-4000-8000-000000000002",
          parent_conversation_key: transcriptFixture.latestRootConversation.conversation_key,
          conversation_key: transcriptFixture.childConversation.conversation_key,
          execution_profile: "executor",
          status: "closed",
          created_at: "2026-03-09T00:01:00.000Z",
          updated_at: "2026-03-09T00:06:00.000Z",
          closed_at: "2026-03-09T00:06:00.000Z",
        },
      });
      await stopDeferred.promise;
    });
    await flush();

    expect(transcriptStore.openConversation).toHaveBeenLastCalledWith(
      transcriptFixture.secondaryAgentRoot.conversation_key,
    );

    cleanupTestRoot(testRoot);
  });

  it("applies agent-only navigation intents without forcing an extra transcript refresh", async () => {
    const onNavigationIntentHandled = vi.fn();
    const { core, transcriptStore, transcriptFixture } = createCore();

    const testRoot = renderIntoDocument(
      React.createElement(AgentsPage, {
        core,
        navigationIntent: {
          agentKey: "agent-1",
          turnId: "missing-run",
          conversationKey: null,
        },
        onNavigationIntentHandled,
      }),
    );
    await flush();

    expect(onNavigationIntentHandled).toHaveBeenCalledTimes(1);
    expect(transcriptStore.refresh).toHaveBeenCalledTimes(1);
    expect(transcriptStore.openConversation).toHaveBeenLastCalledWith(
      transcriptFixture.secondaryAgentRoot.conversation_key,
    );
    expect(testRoot.container.textContent).toContain("Agent One transcript");

    cleanupTestRoot(testRoot);
  });
});
