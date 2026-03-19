import { describe, expect, it, vi } from "vitest";
import { WorkboardService, type WorkboardCrudRepository } from "../src/index.js";

function createRepository(): WorkboardCrudRepository {
  return {
    createItem: vi.fn(),
    listItems: vi.fn(),
    getItem: vi.fn(),
    updateItem: vi.fn(),
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
  };
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
    repository.createItem = vi.fn().mockResolvedValue({
      tenant_id: "default",
      agent_id: "agent-1",
      workspace_id: "workspace-1",
      work_item_id: "work-1",
      parent_work_item_id: null,
      kind: "task",
      title: "Ship runtime split",
      description: null,
      status: "backlog",
      priority: 1,
      created_from_session_key: "agent:default:main",
      fingerprint_json: null,
      acceptance_json: null,
      metadata_json: null,
      created_at: "2026-03-19T00:00:00.000Z",
      updated_at: "2026-03-19T00:00:00.000Z",
    });

    const service = new WorkboardService({ repository });
    const item = await service.createItem({
      scope: {
        tenant_id: "default",
        agent_id: "agent-1",
        workspace_id: "workspace-1",
      },
      item: {
        kind: "task",
        title: "Ship runtime split",
      },
      createdFromSessionKey: "agent:default:main",
    });

    expect(repository.createItem).toHaveBeenCalledWith({
      scope: {
        tenant_id: "default",
        agent_id: "agent-1",
        workspace_id: "workspace-1",
      },
      item: {
        kind: "task",
        title: "Ship runtime split",
      },
      createdFromSessionKey: "agent:default:main",
    });
    expect(item.work_item_id).toBe("work-1");
  });
});
