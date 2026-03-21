// @vitest-environment jsdom

import React, { act } from "react";
import type { OperatorCore } from "../../../operator-app/src/index.js";
import { createStore } from "../../../operator-app/src/store.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TranscriptsPage } from "../../src/components/pages/transcripts-page.js";
import { cleanupTestRoot, click, renderIntoDocument } from "../test-utils.js";

function createTranscriptFixture() {
  const rootSession = {
    session_id: "550e8400-e29b-41d4-a716-446655440010",
    session_key: "agent:default:ui:main",
    agent_id: "default",
    channel: "ui",
    thread_id: "thread-root",
    title: "Root transcript",
    message_count: 2,
    updated_at: "2026-01-01T00:05:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    archived: false,
    latest_run_id: "550e8400-e29b-41d4-a716-446655440110",
    latest_run_status: "running",
    has_active_run: true,
    pending_approval_count: 1,
  };
  const childSession = {
    session_id: "550e8400-e29b-41d4-a716-446655440011",
    session_key: "agent:default:subagent:550e8400-e29b-41d4-a716-446655440099",
    agent_id: "default",
    channel: "subagent",
    thread_id: "thread-child",
    title: "Delegated child",
    message_count: 1,
    updated_at: "2026-01-01T00:04:00.000Z",
    created_at: "2026-01-01T00:01:00.000Z",
    archived: false,
    parent_session_key: rootSession.session_key,
    subagent_id: "550e8400-e29b-41d4-a716-446655440099",
    lane: "subagent",
    subagent_status: "running",
    latest_run_id: null,
    latest_run_status: null,
    has_active_run: false,
    pending_approval_count: 0,
  };
  const artifact = {
    artifact_id: "550e8400-e29b-41d4-a716-446655440120",
    uri: "artifact://550e8400-e29b-41d4-a716-446655440120",
    external_url: "https://gateway.test/artifacts/550e8400-e29b-41d4-a716-446655440120",
    kind: "log",
    media_class: "document",
    created_at: "2026-01-01T00:02:05.000Z",
    filename: "transcript.log",
    mime_type: "text/plain",
    labels: [],
  };
  const events = [
    {
      event_id: "message:agent:default:ui:main:msg-1",
      kind: "message",
      occurred_at: "2026-01-01T00:00:10.000Z",
      session_key: rootSession.session_key,
      payload: {
        message: {
          id: "msg-1",
          role: "user",
          parts: [{ type: "text", text: "Inspect the transcript" }],
        },
      },
    },
    {
      event_id: "run:550e8400-e29b-41d4-a716-446655440110",
      kind: "run",
      occurred_at: "2026-01-01T00:02:00.000Z",
      session_key: rootSession.session_key,
      payload: {
        run: {
          run_id: "550e8400-e29b-41d4-a716-446655440110",
          job_id: "550e8400-e29b-41d4-a716-446655440111",
          key: rootSession.session_key,
          lane: "main",
          status: "running",
          attempt: 1,
          created_at: "2026-01-01T00:02:00.000Z",
          started_at: "2026-01-01T00:02:01.000Z",
          finished_at: null,
        },
        steps: [
          {
            step_id: "550e8400-e29b-41d4-a716-446655440112",
            run_id: "550e8400-e29b-41d4-a716-446655440110",
            step_index: 0,
            status: "running",
            action: { type: "Research", args: {} },
            created_at: "2026-01-01T00:02:00.000Z",
          },
        ],
        attempts: [
          {
            attempt_id: "550e8400-e29b-41d4-a716-446655440113",
            step_id: "550e8400-e29b-41d4-a716-446655440112",
            attempt: 1,
            status: "running",
            started_at: "2026-01-01T00:02:01.000Z",
            finished_at: null,
            error: null,
            artifacts: [artifact],
          },
        ],
      },
    },
    {
      event_id: "approval:550e8400-e29b-41d4-a716-446655440114",
      kind: "approval",
      occurred_at: "2026-01-01T00:03:00.000Z",
      session_key: rootSession.session_key,
      payload: {
        approval: {
          approval_id: "550e8400-e29b-41d4-a716-446655440114",
          approval_key: "approval:transcript",
          agent_id: "default",
          kind: "policy",
          status: "queued",
          prompt: "Approve the next action?",
          motivation: "Approve the next action?",
          scope: {
            run_id: "550e8400-e29b-41d4-a716-446655440110",
            step_id: "550e8400-e29b-41d4-a716-446655440112",
            attempt_id: "550e8400-e29b-41d4-a716-446655440113",
          },
          created_at: "2026-01-01T00:03:00.000Z",
          expires_at: null,
          latest_review: null,
        },
      },
    },
    {
      event_id: "subagent:550e8400-e29b-41d4-a716-446655440099:spawned",
      kind: "subagent",
      occurred_at: "2026-01-01T00:01:00.000Z",
      session_key: childSession.session_key,
      parent_session_key: rootSession.session_key,
      subagent_id: childSession.subagent_id,
      payload: {
        phase: "spawned",
        subagent: {
          subagent_id: "550e8400-e29b-41d4-a716-446655440099",
          agent_id: "00000000-0000-4000-8000-000000000001",
          workspace_id: "00000000-0000-4000-8000-000000000002",
          parent_session_key: rootSession.session_key,
          session_key: childSession.session_key,
          lane: "subagent",
          status: "running",
          execution_profile: "executor",
          created_at: "2026-01-01T00:01:00.000Z",
          updated_at: "2026-01-01T00:01:00.000Z",
          closed_at: null,
        },
      },
    },
  ];

  return { rootSession, childSession, artifact, events };
}

function createTranscriptCore(input?: {
  transcriptState?: Partial<{
    agentId: string | null;
    channel: string | null;
    activeOnly: boolean;
    archived: boolean;
    sessions: unknown[];
    nextCursor: string | null;
    selectedSessionKey: string | null;
    detail: {
      rootSessionKey: string;
      focusSessionKey: string;
      sessions: unknown[];
      events: unknown[];
    } | null;
    loadingList: boolean;
    loadingDetail: boolean;
    errorList: { message: string } | null;
    errorDetail: { message: string } | null;
  }>;
}) {
  const fixture = createTranscriptFixture();
  const { store: connectionStore } = createStore({
    status: "connected",
    clientId: null,
    recovering: false,
    lastDisconnect: null,
    transportError: null,
  });
  const { store: transcriptStoreBase, setState: setTranscriptState } = createStore({
    agentId: null as string | null,
    channel: null as string | null,
    activeOnly: false,
    archived: false,
    sessions: [fixture.rootSession, fixture.childSession],
    nextCursor: null as string | null,
    selectedSessionKey: fixture.rootSession.session_key as string | null,
    detail: {
      rootSessionKey: fixture.rootSession.session_key,
      focusSessionKey: fixture.rootSession.session_key,
      sessions: [fixture.rootSession, fixture.childSession],
      events: fixture.events,
    },
    loadingList: false,
    loadingDetail: false,
    errorList: null as { message: string } | null,
    errorDetail: null as { message: string } | null,
    ...input?.transcriptState,
  });

  const transcriptStore = {
    ...transcriptStoreBase,
    setAgentId: vi.fn(),
    setChannel: vi.fn(),
    setActiveOnly: vi.fn(),
    setArchived: vi.fn(),
    refresh: vi.fn(async () => {}),
    loadMore: vi.fn(async () => {}),
    openSession: vi.fn(async () => {}),
    clearDetail: vi.fn(),
  };

  const agentsList = vi.fn(async () => ({
    agents: [{ agent_key: "default", persona: { name: "Default Agent" } }],
  }));
  const artifactsApi = {
    getMetadata: vi.fn(async () => ({ sensitivity: "internal" })),
    getBytes: vi.fn(async () => ({
      kind: "redirect",
      url: `https://gateway.test/artifacts/${fixture.artifact.artifact_id}`,
    })),
  };

  const core = {
    connectionStore,
    transcriptStore,
    admin: {
      agents: { list: agentsList },
      artifacts: artifactsApi,
    },
    httpBaseUrl: "https://gateway.test",
  } as unknown as OperatorCore;

  return {
    core,
    transcriptStore,
    setTranscriptState,
    agentsList,
    artifactsApi,
    fixture,
  };
}

async function flushPage(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function findButtonByText(container: ParentNode, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  expect(button).toBeDefined();
  return button!;
}

describe("TranscriptsPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("updates transcript filters from the page controls", async () => {
    const { core, transcriptStore, agentsList } = createTranscriptCore();
    const testRoot = renderIntoDocument(React.createElement(TranscriptsPage, { core }));

    await flushPage();

    const selects = testRoot.container.querySelectorAll<HTMLSelectElement>("select");
    const agentSelect = selects[0];
    const channelSelect = selects[1];
    expect(agentSelect).toBeDefined();
    expect(channelSelect).toBeDefined();

    act(() => {
      if (agentSelect) {
        agentSelect.value = "default";
        agentSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (channelSelect) {
        channelSelect.value = "ui";
        channelSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
      click(findButtonByText(testRoot.container, "Active only"));
      click(findButtonByText(testRoot.container, "Archived"));
    });

    expect(agentsList).toHaveBeenCalledTimes(1);
    expect(transcriptStore.refresh).toHaveBeenCalledTimes(1);
    expect(transcriptStore.setAgentId).toHaveBeenCalledWith("default");
    expect(transcriptStore.setChannel).toHaveBeenCalledWith("ui");
    expect(transcriptStore.setActiveOnly).toHaveBeenCalledWith(true);
    expect(transcriptStore.setArchived).toHaveBeenCalledWith(true);

    cleanupTestRoot(testRoot);
  });

  it("renders nested transcript sessions plus inspector artifact previews for run events", async () => {
    const { core, artifactsApi, fixture } = createTranscriptCore();
    const testRoot = renderIntoDocument(React.createElement(TranscriptsPage, { core }));

    await flushPage();

    expect(testRoot.container.textContent).toContain("Root transcript");
    expect(testRoot.container.textContent).toContain("Delegated child");
    expect(testRoot.container.textContent).toContain("Message");
    expect(testRoot.container.textContent).toContain("Execution");
    expect(testRoot.container.textContent).toContain("Approval");
    expect(testRoot.container.textContent).toContain("Subagent");

    const runEvent = testRoot.container.querySelector<HTMLElement>(
      '[data-testid="transcript-event-run:550e8400-e29b-41d4-a716-446655440110"]',
    );
    expect(runEvent).not.toBeNull();

    act(() => {
      click(runEvent as HTMLElement);
    });
    await flushPage();

    expect(testRoot.container.textContent).toContain("Inspector");
    expect(testRoot.container.textContent).toContain("Run key");
    expect(testRoot.container.textContent).toContain(fixture.rootSession.session_key);
    expect(testRoot.container.textContent).toContain("Artifacts");
    expect(testRoot.container.textContent).toContain("Open artifact");
    expect(testRoot.container.textContent).toContain("Download");
    expect(artifactsApi.getMetadata).toHaveBeenCalledWith(
      fixture.artifact.artifact_id,
      expect.anything(),
    );
    expect(artifactsApi.getBytes).toHaveBeenCalledWith(
      fixture.artifact.artifact_id,
      expect.anything(),
    );

    cleanupTestRoot(testRoot);
  });

  it("shows transcript empty states for no sessions and no selected transcript", async () => {
    const noSessions = createTranscriptCore({
      transcriptState: {
        sessions: [],
        selectedSessionKey: null,
        detail: null,
      },
    });
    const emptyRoot = renderIntoDocument(
      React.createElement(TranscriptsPage, { core: noSessions.core }),
    );

    await flushPage();
    expect(emptyRoot.container.textContent).toContain("No transcripts found");
    cleanupTestRoot(emptyRoot);

    const noSelection = createTranscriptCore({
      transcriptState: {
        selectedSessionKey: null,
        detail: null,
      },
    });
    const noSelectionRoot = renderIntoDocument(
      React.createElement(TranscriptsPage, { core: noSelection.core }),
    );

    await flushPage();
    expect(noSelectionRoot.container.textContent).toContain("No transcript selected");
    cleanupTestRoot(noSelectionRoot);
  });

  it("shows the no-events empty state when all transcript event filters are disabled", async () => {
    const { core } = createTranscriptCore();
    const testRoot = renderIntoDocument(React.createElement(TranscriptsPage, { core }));

    await flushPage();

    for (const label of ["Message", "Execution", "Approval", "Subagent"]) {
      act(() => {
        click(findButtonByText(testRoot.container, label));
      });
    }

    expect(testRoot.container.textContent).toContain("No events match these filters");

    cleanupTestRoot(testRoot);
  });

  it("shows inspector guidance when a transcript is focused but no event is selected", async () => {
    const fixture = createTranscriptFixture();
    const { core } = createTranscriptCore({
      transcriptState: {
        selectedSessionKey: fixture.rootSession.session_key,
        detail: {
          rootSessionKey: fixture.rootSession.session_key,
          focusSessionKey: fixture.rootSession.session_key,
          sessions: [fixture.rootSession, fixture.childSession],
          events: [],
        },
      },
    });
    const testRoot = renderIntoDocument(React.createElement(TranscriptsPage, { core }));

    await flushPage();

    expect(testRoot.container.textContent).toContain("Inspector");
    expect(testRoot.container.textContent).toContain("Root transcript");
    expect(testRoot.container.textContent).toContain(
      "Select a transcript event to inspect its raw payload.",
    );

    cleanupTestRoot(testRoot);
  });

  it("does not auto-retry transcript detail loading after a failed detail request", async () => {
    const { core, transcriptStore } = createTranscriptCore({
      transcriptState: {
        selectedSessionKey: "agent:default:ui:main",
        detail: null,
        loadingDetail: false,
        errorDetail: { message: "timed out" },
      },
    });
    const testRoot = renderIntoDocument(React.createElement(TranscriptsPage, { core }));

    await flushPage();

    expect(transcriptStore.openSession).not.toHaveBeenCalled();

    cleanupTestRoot(testRoot);
  });

  it("keeps the selected transcript event in the inspector across transcript detail updates", async () => {
    const { core, fixture, setTranscriptState } = createTranscriptCore();
    const testRoot = renderIntoDocument(React.createElement(TranscriptsPage, { core }));

    await flushPage();

    const approvalEvent = testRoot.container.querySelector<HTMLElement>(
      '[data-testid="transcript-event-approval:550e8400-e29b-41d4-a716-446655440114"]',
    );
    expect(approvalEvent).not.toBeNull();

    act(() => {
      click(approvalEvent as HTMLElement);
    });
    await flushPage();

    expect(testRoot.container.textContent).toContain("Occurred");
    expect(testRoot.container.textContent).toContain("2026-01-01T00:03:00.000Z");

    act(() => {
      setTranscriptState((previous) => ({
        ...previous,
        detail: previous.detail
          ? {
              ...previous.detail,
              events: [
                {
                  event_id: "message:agent:default:ui:main:msg-2",
                  kind: "message",
                  occurred_at: "2026-01-01T00:04:00.000Z",
                  session_key: fixture.rootSession.session_key,
                  payload: {
                    message: {
                      id: "msg-2",
                      role: "assistant",
                      parts: [{ type: "text", text: "A later transcript event" }],
                    },
                  },
                },
                ...previous.detail.events,
              ],
            }
          : null,
      }));
    });
    await flushPage();

    expect(testRoot.container.textContent).toContain("Occurred");
    expect(testRoot.container.textContent).toContain("2026-01-01T00:03:00.000Z");

    cleanupTestRoot(testRoot);
  });
});
