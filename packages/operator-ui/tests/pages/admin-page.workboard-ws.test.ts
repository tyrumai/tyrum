// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { createStore } from "../../../operator-core/src/store.js";
import type {
  AdminModeState,
  AdminModeStore,
} from "../../../operator-core/src/stores/admin-mode-store.js";
import { AdminModeProvider } from "../../src/admin-mode.js";
import { AdminPage } from "../../src/components/pages/admin-page.js";
import {
  cleanupTestRoot,
  click,
  renderIntoDocument,
  setNativeValue,
  type TestRoot,
} from "../test-utils.js";

function createActiveAdminModeStore(): AdminModeStore {
  const activeState: AdminModeState = {
    status: "active",
    elevatedToken: "token",
    enteredAt: "2026-03-01T00:00:00.000Z",
    expiresAt: "2026-03-01T00:10:00.000Z",
    remainingMs: 60_000,
  };

  const { store } = createStore(activeState);
  return {
    ...store,
    enter: vi.fn(),
    exit: vi.fn(),
    dispose: vi.fn(),
  };
}

async function openWorkBoardWsPanels(testRoot: TestRoot): Promise<void> {
  const wsTab = testRoot.container.querySelector<HTMLButtonElement>('[data-testid="admin-tab-ws"]');
  expect(wsTab).not.toBeNull();
  await act(async () => {
    click(wsTab!);
  });

  const workboardTab = testRoot.container.querySelector<HTMLButtonElement>(
    '[data-testid="admin-ws-tab-workboard"]',
  );
  expect(workboardTab).not.toBeNull();
  await act(async () => {
    click(workboardTab!);
  });
}

async function setWorkBoardScope(
  testRoot: TestRoot,
  scope: { tenant_id: string; agent_id: string; workspace_id: string },
): Promise<void> {
  const tenant = testRoot.container.querySelector<HTMLInputElement>(
    '[data-testid="work-scope-tenant-id"]',
  );
  const agent = testRoot.container.querySelector<HTMLInputElement>(
    '[data-testid="work-scope-agent-id"]',
  );
  const workspace = testRoot.container.querySelector<HTMLInputElement>(
    '[data-testid="work-scope-workspace-id"]',
  );
  expect(tenant).not.toBeNull();
  expect(agent).not.toBeNull();
  expect(workspace).not.toBeNull();

  await act(async () => {
    setNativeValue(tenant!, scope.tenant_id);
    setNativeValue(agent!, scope.agent_id);
    setNativeValue(workspace!, scope.workspace_id);
  });
}

describe("AdminPage WorkBoard WS panels", () => {
  it("wires WorkScope + payload JSON to core WorkBoard operations", async () => {
    const workList = vi.fn(async () => ({
      items: [
        {
          work_item_id: "work-1",
          tenant_id: "tenant-1",
          agent_id: "agent-1",
          workspace_id: "ws-1",
          kind: "action",
          title: "First work item",
          status: "ready",
          priority: 0,
          created_at: "2026-03-01T00:00:00Z",
          created_from_session_key: "session-1",
          last_active_at: null,
          parent_work_item_id: null,
        },
      ],
    }));
    const workGet = vi.fn(async () => ({ item: { work_item_id: "work-1" } as unknown }));
    const workCreate = vi.fn(async () => ({ item: { work_item_id: "work-2" } as unknown }));
    const workUpdate = vi.fn(async () => ({ item: { work_item_id: "work-1" } as unknown }));
    const workTransition = vi.fn(async () => ({ item: { work_item_id: "work-1" } as unknown }));
    const workSignalList = vi.fn(async () => ({ signals: [] }));
    const workSignalGet = vi.fn(async () => ({ signal: { signal_id: "signal-1" } as unknown }));
    const workSignalCreate = vi.fn(async () => ({ signal: { signal_id: "signal-1" } as unknown }));
    const workSignalUpdate = vi.fn(async () => ({ signal: { signal_id: "signal-1" } as unknown }));
    const workStateKvGet = vi.fn(async () => ({ entry: { key: "key-1" } as unknown }));
    const workStateKvList = vi.fn(async () => ({ entries: [] }));
    const workStateKvSet = vi.fn(async () => ({ entry: { key: "key-1" } as unknown }));

    const adminModeStore = createActiveAdminModeStore();

    const core = {
      httpBaseUrl: "http://example.test",
      adminModeStore,
      ws: {
        on: vi.fn(),
        off: vi.fn(),
        workList,
        workGet,
        workCreate,
        workUpdate,
        workTransition,
        workSignalList,
        workSignalGet,
        workSignalCreate,
        workSignalUpdate,
        workStateKvGet,
        workStateKvList,
        workStateKvSet,
      },
    } as unknown as OperatorCore;

    const testRoot = renderIntoDocument(
      React.createElement(AdminModeProvider, {
        core,
        mode: "web",
        children: React.createElement(AdminPage, { core }),
      }),
    );

    await openWorkBoardWsPanels(testRoot);
    await setWorkBoardScope(testRoot, {
      tenant_id: "tenant-1",
      agent_id: "agent-1",
      workspace_id: "ws-1",
    });

    const listPayload = testRoot.container.querySelector<HTMLTextAreaElement>(
      '[data-testid="admin-ws-work-list-payload"]',
    );
    const listRun = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-ws-work-list-run"]',
    );
    expect(listPayload).not.toBeNull();
    expect(listRun).not.toBeNull();

    await act(async () => {
      setNativeValue(listPayload!, JSON.stringify({ limit: 1 }));
      click(listRun!);
      await Promise.resolve();
    });

    expect(workList).toHaveBeenCalledWith({
      tenant_id: "tenant-1",
      agent_id: "agent-1",
      workspace_id: "ws-1",
      limit: 1,
    });
    expect(testRoot.container.textContent).toContain("First work item");

    const getPayload = testRoot.container.querySelector<HTMLTextAreaElement>(
      '[data-testid="admin-ws-work-get-payload"]',
    );
    const getRun = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-ws-work-get-run"]',
    );
    expect(getPayload).not.toBeNull();
    expect(getRun).not.toBeNull();

    await act(async () => {
      setNativeValue(getPayload!, JSON.stringify({ tenant_id: "bad", work_item_id: "work-1" }));
      click(getRun!);
      await Promise.resolve();
    });

    expect(workGet).toHaveBeenCalledWith({
      tenant_id: "tenant-1",
      agent_id: "agent-1",
      workspace_id: "ws-1",
      work_item_id: "work-1",
    });

    const createPayload = testRoot.container.querySelector<HTMLTextAreaElement>(
      '[data-testid="admin-ws-work-create-payload"]',
    );
    const createRun = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-ws-work-create-run"]',
    );
    expect(createPayload).not.toBeNull();
    expect(createRun).not.toBeNull();

    await act(async () => {
      setNativeValue(
        createPayload!,
        JSON.stringify({ item: { kind: "action", title: "New item" } }),
      );
      click(createRun!);
      await Promise.resolve();
    });

    expect(workCreate).toHaveBeenCalledWith({
      tenant_id: "tenant-1",
      agent_id: "agent-1",
      workspace_id: "ws-1",
      item: { kind: "action", title: "New item" },
    });

    const updatePayload = testRoot.container.querySelector<HTMLTextAreaElement>(
      '[data-testid="admin-ws-work-update-payload"]',
    );
    const updateRun = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-ws-work-update-run"]',
    );
    expect(updatePayload).not.toBeNull();
    expect(updateRun).not.toBeNull();

    await act(async () => {
      setNativeValue(
        updatePayload!,
        JSON.stringify({ work_item_id: "work-1", patch: { title: "Updated" } }),
      );
      click(updateRun!);
      await Promise.resolve();
    });

    expect(workUpdate).toHaveBeenCalledWith({
      tenant_id: "tenant-1",
      agent_id: "agent-1",
      workspace_id: "ws-1",
      work_item_id: "work-1",
      patch: { title: "Updated" },
    });

    const transitionPayload = testRoot.container.querySelector<HTMLTextAreaElement>(
      '[data-testid="admin-ws-work-transition-payload"]',
    );
    const transitionRun = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-ws-work-transition-run"]',
    );
    expect(transitionPayload).not.toBeNull();
    expect(transitionRun).not.toBeNull();

    await act(async () => {
      setNativeValue(
        transitionPayload!,
        JSON.stringify({ work_item_id: "work-1", status: "done", reason: "ok" }),
      );
      click(transitionRun!);
      await Promise.resolve();
    });

    expect(workTransition).toHaveBeenCalledWith({
      tenant_id: "tenant-1",
      agent_id: "agent-1",
      workspace_id: "ws-1",
      work_item_id: "work-1",
      status: "done",
      reason: "ok",
    });

    const signalListPayload = testRoot.container.querySelector<HTMLTextAreaElement>(
      '[data-testid="admin-ws-work-signal-list-payload"]',
    );
    const signalListRun = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-ws-work-signal-list-run"]',
    );
    expect(signalListPayload).not.toBeNull();
    expect(signalListRun).not.toBeNull();

    const signalListDefault = JSON.parse(signalListPayload!.value) as Record<string, unknown>;
    expect(signalListDefault).not.toHaveProperty("work_item_id");
    expect(signalListDefault).toHaveProperty("limit", 50);

    await act(async () => {
      setNativeValue(
        signalListPayload!,
        JSON.stringify({ tenant_id: "bad", work_item_id: "work-1", limit: 1 }),
      );
      click(signalListRun!);
      await Promise.resolve();
    });

    expect(workSignalList).toHaveBeenCalledWith({
      tenant_id: "tenant-1",
      agent_id: "agent-1",
      workspace_id: "ws-1",
      work_item_id: "work-1",
      limit: 1,
    });

    const signalGetPayload = testRoot.container.querySelector<HTMLTextAreaElement>(
      '[data-testid="admin-ws-work-signal-get-payload"]',
    );
    const signalGetRun = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-ws-work-signal-get-run"]',
    );
    expect(signalGetPayload).not.toBeNull();
    expect(signalGetRun).not.toBeNull();

    await act(async () => {
      setNativeValue(
        signalGetPayload!,
        JSON.stringify({ signal_id: "signal-1", tenant_id: "bad" }),
      );
      click(signalGetRun!);
      await Promise.resolve();
    });

    expect(workSignalGet).toHaveBeenCalledWith({
      tenant_id: "tenant-1",
      agent_id: "agent-1",
      workspace_id: "ws-1",
      signal_id: "signal-1",
    });

    const signalCreatePayload = testRoot.container.querySelector<HTMLTextAreaElement>(
      '[data-testid="admin-ws-work-signal-create-payload"]',
    );
    const signalCreateRun = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-ws-work-signal-create-run"]',
    );
    expect(signalCreatePayload).not.toBeNull();
    expect(signalCreateRun).not.toBeNull();

    await act(async () => {
      setNativeValue(
        signalCreatePayload!,
        JSON.stringify({
          signal: {
            trigger_kind: "time",
            trigger_spec_json: { after_seconds: 60 },
            payload_json: { hello: "world" },
            status: "active",
          },
        }),
      );
      click(signalCreateRun!);
      await Promise.resolve();
    });

    expect(workSignalCreate).toHaveBeenCalledWith({
      tenant_id: "tenant-1",
      agent_id: "agent-1",
      workspace_id: "ws-1",
      signal: {
        trigger_kind: "time",
        trigger_spec_json: { after_seconds: 60 },
        payload_json: { hello: "world" },
        status: "active",
      },
    });

    const signalUpdatePayload = testRoot.container.querySelector<HTMLTextAreaElement>(
      '[data-testid="admin-ws-work-signal-update-payload"]',
    );
    const signalUpdateRun = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-ws-work-signal-update-run"]',
    );
    expect(signalUpdatePayload).not.toBeNull();
    expect(signalUpdateRun).not.toBeNull();

    await act(async () => {
      setNativeValue(
        signalUpdatePayload!,
        JSON.stringify({ signal_id: "signal-1", patch: { status: "paused" }, tenant_id: "bad" }),
      );
      click(signalUpdateRun!);
      await Promise.resolve();
    });

    expect(workSignalUpdate).toHaveBeenCalledWith({
      tenant_id: "tenant-1",
      agent_id: "agent-1",
      workspace_id: "ws-1",
      signal_id: "signal-1",
      patch: { status: "paused" },
    });

    const stateKvGetPayload = testRoot.container.querySelector<HTMLTextAreaElement>(
      '[data-testid="admin-ws-work-state-kv-get-payload"]',
    );
    const stateKvGetRun = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-ws-work-state-kv-get-run"]',
    );
    expect(stateKvGetPayload).not.toBeNull();
    expect(stateKvGetRun).not.toBeNull();

    await act(async () => {
      setNativeValue(
        stateKvGetPayload!,
        JSON.stringify({ scope: { kind: "agent", tenant_id: "bad" }, key: "key-1" }),
      );
      click(stateKvGetRun!);
      await Promise.resolve();
    });

    expect(workStateKvGet).toHaveBeenCalledWith({
      scope: { kind: "agent", tenant_id: "tenant-1", agent_id: "agent-1", workspace_id: "ws-1" },
      key: "key-1",
    });

    const stateKvListPayload = testRoot.container.querySelector<HTMLTextAreaElement>(
      '[data-testid="admin-ws-work-state-kv-list-payload"]',
    );
    const stateKvListRun = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-ws-work-state-kv-list-run"]',
    );
    expect(stateKvListPayload).not.toBeNull();
    expect(stateKvListRun).not.toBeNull();

    const stateKvListDefault = JSON.parse(stateKvListPayload!.value) as Record<string, unknown>;
    expect(stateKvListDefault).not.toHaveProperty("prefix");
    expect(stateKvListDefault).toHaveProperty("scope", { kind: "agent" });

    await act(async () => {
      setNativeValue(
        stateKvListPayload!,
        JSON.stringify({ scope: { kind: "agent", workspace_id: "bad" }, prefix: "work." }),
      );
      click(stateKvListRun!);
      await Promise.resolve();
    });

    expect(workStateKvList).toHaveBeenCalledWith({
      scope: { kind: "agent", tenant_id: "tenant-1", agent_id: "agent-1", workspace_id: "ws-1" },
      prefix: "work.",
    });

    const stateKvSetPayload = testRoot.container.querySelector<HTMLTextAreaElement>(
      '[data-testid="admin-ws-work-state-kv-set-payload"]',
    );
    const stateKvSetRun = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-ws-work-state-kv-set-run"]',
    );
    expect(stateKvSetPayload).not.toBeNull();
    expect(stateKvSetRun).not.toBeNull();

    await act(async () => {
      setNativeValue(
        stateKvSetPayload!,
        JSON.stringify({
          scope: { kind: "agent" },
          key: "key-1",
          value_json: { ready: true },
        }),
      );
      click(stateKvSetRun!);
      await Promise.resolve();
    });

    expect(workStateKvSet).toHaveBeenCalledWith({
      scope: { kind: "agent", tenant_id: "tenant-1", agent_id: "agent-1", workspace_id: "ws-1" },
      key: "key-1",
      value_json: { ready: true },
    });

    cleanupTestRoot(testRoot);
  });

  it("wires WorkScope + payload JSON to core WorkBoard drilldown operations", async () => {
    const workLinkCreate = vi.fn(async () => ({
      link: { work_item_id: "work-1", linked_work_item_id: "work-2", kind: "depends_on" },
    }));
    const workLinkList = vi.fn(async () => ({
      links: [{ work_item_id: "work-1", linked_work_item_id: "work-2", kind: "depends_on" }],
    }));

    const workArtifactList = vi.fn(async () => ({
      artifacts: [
        {
          artifact_id: "artifact-1",
          tenant_id: "tenant-1",
          agent_id: "agent-1",
          workspace_id: "ws-1",
          work_item_id: "work-1",
          kind: "other",
          title: "First artifact",
          refs: [],
          created_at: "2026-03-01T00:00:00Z",
        },
      ],
    }));
    const workArtifactGet = vi.fn(async () => ({
      artifact: { artifact_id: "artifact-1", kind: "other", title: "First artifact" },
    }));
    const workArtifactCreate = vi.fn(async () => ({
      artifact: { artifact_id: "artifact-2", kind: "other", title: "New artifact" },
    }));

    const workDecisionList = vi.fn(async () => ({
      decisions: [
        {
          decision_id: "decision-1",
          tenant_id: "tenant-1",
          agent_id: "agent-1",
          workspace_id: "ws-1",
          work_item_id: "work-1",
          question: "Should we ship?",
          chosen: "Yes",
          alternatives: [],
          rationale_md: "Because.",
          input_artifact_ids: [],
          created_at: "2026-03-01T00:00:00Z",
        },
      ],
    }));
    const workDecisionGet = vi.fn(async () => ({
      decision: { decision_id: "decision-1", question: "Should we ship?" },
    }));
    const workDecisionCreate = vi.fn(async () => ({
      decision: { decision_id: "decision-2", question: "New decision?" },
    }));

    const adminModeStore = createActiveAdminModeStore();

    const core = {
      httpBaseUrl: "http://example.test",
      adminModeStore,
      ws: {
        on: vi.fn(),
        off: vi.fn(),
        workLinkCreate,
        workLinkList,
        workArtifactList,
        workArtifactGet,
        workArtifactCreate,
        workDecisionList,
        workDecisionGet,
        workDecisionCreate,
      },
    } as unknown as OperatorCore;

    const testRoot = renderIntoDocument(
      React.createElement(AdminModeProvider, {
        core,
        mode: "web",
        children: React.createElement(AdminPage, { core }),
      }),
    );

    await openWorkBoardWsPanels(testRoot);
    await setWorkBoardScope(testRoot, {
      tenant_id: "tenant-1",
      agent_id: "agent-1",
      workspace_id: "ws-1",
    });

    const linkCreatePayload = testRoot.container.querySelector<HTMLTextAreaElement>(
      '[data-testid="admin-ws-work-link-create-payload"]',
    );
    const linkCreateRun = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-ws-work-link-create-run"]',
    );
    expect(linkCreatePayload).not.toBeNull();
    expect(linkCreateRun).not.toBeNull();
    await act(async () => {
      setNativeValue(
        linkCreatePayload!,
        JSON.stringify({
          tenant_id: "bad",
          work_item_id: "work-1",
          linked_work_item_id: "work-2",
          kind: "depends_on",
        }),
      );
      click(linkCreateRun!);
      await Promise.resolve();
    });
    expect(workLinkCreate).toHaveBeenCalledWith({
      tenant_id: "tenant-1",
      agent_id: "agent-1",
      workspace_id: "ws-1",
      work_item_id: "work-1",
      linked_work_item_id: "work-2",
      kind: "depends_on",
    });

    const linkListPayload = testRoot.container.querySelector<HTMLTextAreaElement>(
      '[data-testid="admin-ws-work-link-list-payload"]',
    );
    const linkListRun = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-ws-work-link-list-run"]',
    );
    expect(linkListPayload).not.toBeNull();
    expect(linkListRun).not.toBeNull();
    await act(async () => {
      setNativeValue(linkListPayload!, JSON.stringify({ work_item_id: "work-1", limit: 2 }));
      click(linkListRun!);
      await Promise.resolve();
    });
    expect(workLinkList).toHaveBeenCalledWith({
      tenant_id: "tenant-1",
      agent_id: "agent-1",
      workspace_id: "ws-1",
      work_item_id: "work-1",
      limit: 2,
    });
    expect(testRoot.container.textContent).toContain("depends_on");

    const artifactListPayload = testRoot.container.querySelector<HTMLTextAreaElement>(
      '[data-testid="admin-ws-work-artifact-list-payload"]',
    );
    const artifactListRun = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-ws-work-artifact-list-run"]',
    );
    expect(artifactListPayload).not.toBeNull();
    expect(artifactListRun).not.toBeNull();
    await act(async () => {
      setNativeValue(artifactListPayload!, JSON.stringify({ work_item_id: "work-1", limit: 1 }));
      click(artifactListRun!);
      await Promise.resolve();
    });
    expect(workArtifactList).toHaveBeenCalledWith({
      tenant_id: "tenant-1",
      agent_id: "agent-1",
      workspace_id: "ws-1",
      work_item_id: "work-1",
      limit: 1,
    });
    expect(testRoot.container.textContent).toContain("First artifact");

    const artifactGetPayload = testRoot.container.querySelector<HTMLTextAreaElement>(
      '[data-testid="admin-ws-work-artifact-get-payload"]',
    );
    const artifactGetRun = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-ws-work-artifact-get-run"]',
    );
    expect(artifactGetPayload).not.toBeNull();
    expect(artifactGetRun).not.toBeNull();
    await act(async () => {
      setNativeValue(artifactGetPayload!, JSON.stringify({ artifact_id: "artifact-1" }));
      click(artifactGetRun!);
      await Promise.resolve();
    });
    expect(workArtifactGet).toHaveBeenCalledWith({
      tenant_id: "tenant-1",
      agent_id: "agent-1",
      workspace_id: "ws-1",
      artifact_id: "artifact-1",
    });

    const artifactCreatePayload = testRoot.container.querySelector<HTMLTextAreaElement>(
      '[data-testid="admin-ws-work-artifact-create-payload"]',
    );
    const artifactCreateRun = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-ws-work-artifact-create-run"]',
    );
    expect(artifactCreatePayload).not.toBeNull();
    expect(artifactCreateRun).not.toBeNull();
    await act(async () => {
      setNativeValue(
        artifactCreatePayload!,
        JSON.stringify({ artifact: { kind: "other", title: "New artifact" } }),
      );
      click(artifactCreateRun!);
      await Promise.resolve();
    });
    expect(workArtifactCreate).toHaveBeenCalledWith({
      tenant_id: "tenant-1",
      agent_id: "agent-1",
      workspace_id: "ws-1",
      artifact: { kind: "other", title: "New artifact" },
    });

    const decisionListPayload = testRoot.container.querySelector<HTMLTextAreaElement>(
      '[data-testid="admin-ws-work-decision-list-payload"]',
    );
    const decisionListRun = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-ws-work-decision-list-run"]',
    );
    expect(decisionListPayload).not.toBeNull();
    expect(decisionListRun).not.toBeNull();
    await act(async () => {
      setNativeValue(decisionListPayload!, JSON.stringify({ work_item_id: "work-1", limit: 1 }));
      click(decisionListRun!);
      await Promise.resolve();
    });
    expect(workDecisionList).toHaveBeenCalledWith({
      tenant_id: "tenant-1",
      agent_id: "agent-1",
      workspace_id: "ws-1",
      work_item_id: "work-1",
      limit: 1,
    });
    expect(testRoot.container.textContent).toContain("Should we ship?");

    const decisionGetPayload = testRoot.container.querySelector<HTMLTextAreaElement>(
      '[data-testid="admin-ws-work-decision-get-payload"]',
    );
    const decisionGetRun = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-ws-work-decision-get-run"]',
    );
    expect(decisionGetPayload).not.toBeNull();
    expect(decisionGetRun).not.toBeNull();
    await act(async () => {
      setNativeValue(decisionGetPayload!, JSON.stringify({ decision_id: "decision-1" }));
      click(decisionGetRun!);
      await Promise.resolve();
    });
    expect(workDecisionGet).toHaveBeenCalledWith({
      tenant_id: "tenant-1",
      agent_id: "agent-1",
      workspace_id: "ws-1",
      decision_id: "decision-1",
    });

    const decisionCreatePayload = testRoot.container.querySelector<HTMLTextAreaElement>(
      '[data-testid="admin-ws-work-decision-create-payload"]',
    );
    const decisionCreateRun = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-ws-work-decision-create-run"]',
    );
    expect(decisionCreatePayload).not.toBeNull();
    expect(decisionCreateRun).not.toBeNull();
    await act(async () => {
      setNativeValue(
        decisionCreatePayload!,
        JSON.stringify({
          decision: { question: "New decision?", chosen: "Yes", rationale_md: "Because." },
        }),
      );
      click(decisionCreateRun!);
      await Promise.resolve();
    });
    expect(workDecisionCreate).toHaveBeenCalledWith({
      tenant_id: "tenant-1",
      agent_id: "agent-1",
      workspace_id: "ws-1",
      decision: { question: "New decision?", chosen: "Yes", rationale_md: "Because." },
    });

    cleanupTestRoot(testRoot);
  });
});
