import { describe, expect, it, vi } from "vitest";
import { WorkboardService, type WorkboardServiceRepository } from "../src/index.js";
import { TEST_SCOPE, makeWorkItem } from "./test-support.js";

function createRepository(): WorkboardServiceRepository {
  const repository: WorkboardServiceRepository = {
    createItem: vi.fn(),
    listItems: vi.fn(),
    getItem: vi.fn(),
    updateItem: vi.fn(),
    deleteItem: vi.fn(),
    transitionItem: vi.fn(),
    createLink: vi.fn(),
    listLinks: vi.fn(),
    listArtifacts: vi.fn(),
    getArtifact: vi.fn(),
    createArtifact: vi.fn(),
    listDecisions: vi.fn(),
    getDecision: vi.fn(),
    createDecision: vi.fn(),
    listSignals: vi.fn(),
    getSignal: vi.fn(),
    createSignal: vi.fn(),
    updateSignal: vi.fn(),
    getStateKv: vi.fn(),
    listStateKv: vi.fn(),
    setStateKv: vi.fn(),
    listTaskRows: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    listSubagents: vi.fn(),
    updateSubagent: vi.fn(),
    closeSubagent: vi.fn(),
    markSubagentClosed: vi.fn(),
  };
  repository.listTaskRows.mockResolvedValue([]);
  repository.listSubagents.mockResolvedValue({ subagents: [] });
  return repository;
}

describe("WorkboardService", () => {
  it("rejects self-referential work item links before reaching the repository", async () => {
    const repository = createRepository();
    const service = new WorkboardService({ repository });

    await expect(
      service.createLink({
        scope: {
          tenant_id: "default",
          agent_id: "agent-1",
          workspace_id: "workspace-1",
        },
        work_item_id: "work-1",
        linked_work_item_id: "work-1",
        kind: "blocks",
      }),
    ).rejects.toThrow("work item cannot link to itself");

    expect(repository.createLink).not.toHaveBeenCalled();
  });

  it("delegates work item creation through the injected repository", async () => {
    const repository = createRepository();
    repository.createItem = vi.fn().mockResolvedValue(makeWorkItem());

    const service = new WorkboardService({ repository });
    const item = await service.createItem({
      scope: TEST_SCOPE,
      item: {
        kind: "action",
        title: "Ship runtime split",
      },
      createdFromConversationKey: "agent:default:main",
    });

    expect(repository.createItem).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      item: {
        kind: "action",
        title: "Ship runtime split",
      },
      createdFromConversationKey: "agent:default:main",
    });
    expect(item.work_item_id).toBe("work-1");
  });

  it("delegates the remaining repository-backed operations", async () => {
    const repository = createRepository();
    const service = new WorkboardService({ repository });

    const listItemsResult = { items: [makeWorkItem()], next_cursor: "next-items" };
    const getItemResult = makeWorkItem({ work_item_id: "work-2" });
    const updateItemResult = makeWorkItem({ title: "Updated title" });
    const transitionItemResult = makeWorkItem({ status: "doing" });
    const linkResult = {
      work_item_id: "work-1",
      linked_work_item_id: "work-2",
      kind: "depends_on" as const,
      meta_json: { source: "test" },
      created_at: "2026-03-19T00:00:00.000Z",
    };
    const listLinksResult = { links: [linkResult] };
    const artifact = {
      artifact_id: "artifact-1",
      tenant_id: TEST_SCOPE.tenant_id,
      agent_id: TEST_SCOPE.agent_id,
      workspace_id: TEST_SCOPE.workspace_id,
      scope: "work_item" as const,
      work_item_id: "work-1",
      kind: "text/plain",
      label: "Artifact",
      storage_uri: "file:///tmp/artifact-1",
      sha256: "abc",
      size_bytes: 10,
      sensitivity: "operational" as const,
      created_at: "2026-03-19T00:00:00.000Z",
    };
    const listArtifactsResult = { artifacts: [artifact], next_cursor: "next-artifacts" };
    const decision = {
      decision_id: "decision-1",
      tenant_id: TEST_SCOPE.tenant_id,
      agent_id: TEST_SCOPE.agent_id,
      workspace_id: TEST_SCOPE.workspace_id,
      work_item_id: "work-1",
      summary: "Ship it",
      rationale: "Looks good",
      created_at: "2026-03-19T00:00:00.000Z",
    };
    const listDecisionsResult = { decisions: [decision], next_cursor: "next-decisions" };
    const signal = {
      signal_id: "signal-1",
      tenant_id: TEST_SCOPE.tenant_id,
      agent_id: TEST_SCOPE.agent_id,
      workspace_id: TEST_SCOPE.workspace_id,
      work_item_id: "work-1",
      kind: "clarification",
      status: "open" as const,
      summary: "Need review",
      created_at: "2026-03-19T00:00:00.000Z",
      updated_at: "2026-03-19T00:00:00.000Z",
    };
    const listSignalsResult = { signals: [signal], next_cursor: "next-signals" };
    const stateEntry = {
      key: "work.dispatch.phase",
      value_json: "unassigned",
      provenance_json: { source: "test" },
      updated_at: "2026-03-19T00:00:00.000Z",
    };
    const stateEntriesResult = { entries: [stateEntry] };
    const updateSignalResult = { signal, changed: true };

    repository.listItems = vi.fn().mockResolvedValue(listItemsResult);
    repository.getItem = vi.fn().mockResolvedValue(getItemResult);
    repository.updateItem = vi.fn().mockResolvedValue(updateItemResult);
    repository.transitionItem = vi.fn().mockResolvedValue(transitionItemResult);
    repository.createLink = vi.fn().mockResolvedValue(linkResult);
    repository.listLinks = vi.fn().mockResolvedValue(listLinksResult);
    repository.listArtifacts = vi.fn().mockResolvedValue(listArtifactsResult);
    repository.getArtifact = vi.fn().mockResolvedValue(artifact);
    repository.createArtifact = vi.fn().mockResolvedValue(artifact);
    repository.listDecisions = vi.fn().mockResolvedValue(listDecisionsResult);
    repository.getDecision = vi.fn().mockResolvedValue(decision);
    repository.createDecision = vi.fn().mockResolvedValue(decision);
    repository.listSignals = vi.fn().mockResolvedValue(listSignalsResult);
    repository.getSignal = vi.fn().mockResolvedValue(signal);
    repository.createSignal = vi.fn().mockResolvedValue(signal);
    repository.updateSignal = vi.fn().mockResolvedValue(updateSignalResult);
    repository.getStateKv = vi.fn().mockResolvedValue(stateEntry);
    repository.listStateKv = vi.fn().mockResolvedValue(stateEntriesResult);
    repository.setStateKv = vi.fn().mockResolvedValue(stateEntry);

    await expect(
      service.listItems({
        scope: TEST_SCOPE,
        statuses: ["backlog"],
        kinds: ["action"],
        limit: 10,
      }),
    ).resolves.toBe(listItemsResult);
    await expect(service.getItem({ scope: TEST_SCOPE, work_item_id: "work-2" })).resolves.toBe(
      getItemResult,
    );
    await expect(
      service.updateItem({
        scope: TEST_SCOPE,
        work_item_id: "work-2",
        patch: { title: "Updated title" },
      }),
    ).resolves.toBe(updateItemResult);
    await expect(
      service.transitionItem({
        scope: TEST_SCOPE,
        work_item_id: "work-2",
        status: "doing",
        reason: "Start work",
      }),
    ).resolves.toBe(transitionItemResult);
    await expect(
      service.createLink({
        scope: TEST_SCOPE,
        work_item_id: "work-1",
        linked_work_item_id: "work-2",
        kind: "depends_on",
      }),
    ).resolves.toBe(linkResult);
    await expect(
      service.listLinks({ scope: TEST_SCOPE, work_item_id: "work-1", limit: 10 }),
    ).resolves.toBe(listLinksResult);
    await expect(
      service.listArtifacts({ scope: TEST_SCOPE, work_item_id: "work-1", limit: 10 }),
    ).resolves.toBe(listArtifactsResult);
    await expect(
      service.getArtifact({ scope: TEST_SCOPE, artifact_id: "artifact-1" }),
    ).resolves.toBe(artifact);
    await expect(
      service.createArtifact({
        scope: TEST_SCOPE,
        artifact: {
          work_item_id: "work-1",
          kind: "text/plain",
          label: "Artifact",
          storage_uri: "file:///tmp/artifact-1",
          sha256: "abc",
          size_bytes: 10,
          sensitivity: "operational",
        },
      }),
    ).resolves.toBe(artifact);
    await expect(
      service.listDecisions({ scope: TEST_SCOPE, work_item_id: "work-1", limit: 10 }),
    ).resolves.toBe(listDecisionsResult);
    await expect(
      service.getDecision({ scope: TEST_SCOPE, decision_id: "decision-1" }),
    ).resolves.toBe(decision);
    await expect(
      service.createDecision({
        scope: TEST_SCOPE,
        decision: { work_item_id: "work-1", summary: "Ship it", rationale: "Looks good" },
      }),
    ).resolves.toBe(decision);
    await expect(
      service.listSignals({
        scope: TEST_SCOPE,
        work_item_id: "work-1",
        statuses: ["open"],
        limit: 10,
      }),
    ).resolves.toBe(listSignalsResult);
    await expect(service.getSignal({ scope: TEST_SCOPE, signal_id: "signal-1" })).resolves.toBe(
      signal,
    );
    await expect(
      service.createSignal({
        scope: TEST_SCOPE,
        signal: {
          work_item_id: "work-1",
          kind: "clarification",
          status: "open",
          summary: "Need review",
        },
      }),
    ).resolves.toBe(signal);
    await expect(
      service.updateSignal({
        scope: TEST_SCOPE,
        signal_id: "signal-1",
        patch: { status: "resolved", summary: "Done" },
      }),
    ).resolves.toBe(updateSignalResult);
    await expect(
      service.getStateKv({
        scope: { kind: "work_item", ...TEST_SCOPE, work_item_id: "work-1" },
        key: "work.dispatch.phase",
      }),
    ).resolves.toBe(stateEntry);
    await expect(
      service.listStateKv({
        scope: { kind: "work_item", ...TEST_SCOPE, work_item_id: "work-1" },
        prefix: "work.",
      }),
    ).resolves.toBe(stateEntriesResult);
    await expect(
      service.setStateKv({
        scope: { kind: "work_item", ...TEST_SCOPE, work_item_id: "work-1" },
        key: "work.dispatch.phase",
        value_json: "assigned",
        provenance_json: { source: "test" },
      }),
    ).resolves.toBe(stateEntry);

    expect(repository.listItems).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      statuses: ["backlog"],
      kinds: ["action"],
      limit: 10,
    });
    expect(repository.getItem).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      work_item_id: "work-2",
    });
    expect(repository.updateItem).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      work_item_id: "work-2",
      patch: { title: "Updated title" },
    });
    expect(repository.transitionItem).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      work_item_id: "work-2",
      status: "doing",
      reason: "Start work",
    });
    expect(repository.createLink).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      work_item_id: "work-1",
      linked_work_item_id: "work-2",
      kind: "depends_on",
    });
    expect(repository.listLinks).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      work_item_id: "work-1",
      limit: 10,
    });
    expect(repository.listArtifacts).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      work_item_id: "work-1",
      limit: 10,
    });
    expect(repository.getArtifact).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      artifact_id: "artifact-1",
    });
    expect(repository.createArtifact).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      artifact: {
        work_item_id: "work-1",
        kind: "text/plain",
        label: "Artifact",
        storage_uri: "file:///tmp/artifact-1",
        sha256: "abc",
        size_bytes: 10,
        sensitivity: "operational",
      },
    });
    expect(repository.listDecisions).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      work_item_id: "work-1",
      limit: 10,
    });
    expect(repository.getDecision).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      decision_id: "decision-1",
    });
    expect(repository.createDecision).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      decision: { work_item_id: "work-1", summary: "Ship it", rationale: "Looks good" },
    });
    expect(repository.listSignals).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      work_item_id: "work-1",
      statuses: ["open"],
      limit: 10,
    });
    expect(repository.getSignal).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      signal_id: "signal-1",
    });
    expect(repository.createSignal).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      signal: {
        work_item_id: "work-1",
        kind: "clarification",
        status: "open",
        summary: "Need review",
      },
    });
    expect(repository.updateSignal).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      signal_id: "signal-1",
      patch: { status: "resolved", summary: "Done" },
    });
    expect(repository.getStateKv).toHaveBeenCalledWith({
      scope: { kind: "work_item", ...TEST_SCOPE, work_item_id: "work-1" },
      key: "work.dispatch.phase",
    });
    expect(repository.listStateKv).toHaveBeenCalledWith({
      scope: { kind: "work_item", ...TEST_SCOPE, work_item_id: "work-1" },
      prefix: "work.",
    });
    expect(repository.setStateKv).toHaveBeenCalledWith({
      scope: { kind: "work_item", ...TEST_SCOPE, work_item_id: "work-1" },
      key: "work.dispatch.phase",
      value_json: "assigned",
      provenance_json: { source: "test" },
    });
  });
});
