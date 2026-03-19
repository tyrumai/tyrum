import { describe, expect, it, vi } from "vitest";
import {
  SubagentService,
  type WorkboardRepository,
  type WorkboardSubagentRuntime,
} from "../src/index.js";

function createRepository() {
  return {
    createSubagent: vi.fn(),
    getSubagent: vi.fn(),
    listSubagents: vi.fn(),
    closeSubagent: vi.fn(),
    markSubagentClosed: vi.fn(),
    markSubagentFailed: vi.fn(),
    updateSubagent: vi.fn(),
  } satisfies Pick<
    WorkboardRepository,
    | "createSubagent"
    | "getSubagent"
    | "listSubagents"
    | "closeSubagent"
    | "markSubagentClosed"
    | "markSubagentFailed"
    | "updateSubagent"
  >;
}

describe("SubagentService", () => {
  it("builds a session key through the injected runtime port when one is not provided", async () => {
    const repository = createRepository();
    repository.createSubagent.mockResolvedValue({
      subagent_id: "123e4567-e89b-12d3-a456-426614174111",
      tenant_id: "default",
      agent_id: "123e4567-e89b-12d3-a456-426614174000",
      workspace_id: "123e4567-e89b-12d3-a456-426614174001",
      execution_profile: "planner",
      session_key: "agent:default:subagent:123e4567-e89b-12d3-a456-426614174111",
      lane: "subagent",
      status: "paused",
      created_at: "2026-03-19T00:00:00.000Z",
    });

    const runtime: WorkboardSubagentRuntime = {
      buildSessionKey: vi
        .fn()
        .mockResolvedValue("agent:default:subagent:123e4567-e89b-12d3-a456-426614174111"),
      runTurn: vi.fn(),
    };

    const service = new SubagentService({ repository, runtime });
    await service.createSubagent({
      scope: {
        tenant_id: "default",
        agent_id: "123e4567-e89b-12d3-a456-426614174000",
        workspace_id: "123e4567-e89b-12d3-a456-426614174001",
      },
      subagentId: "123e4567-e89b-12d3-a456-426614174111",
      subagent: {
        execution_profile: "planner",
        lane: "subagent",
        status: "paused",
      },
    });

    expect(runtime.buildSessionKey).toHaveBeenCalledWith(
      {
        tenant_id: "default",
        agent_id: "123e4567-e89b-12d3-a456-426614174000",
        workspace_id: "123e4567-e89b-12d3-a456-426614174001",
      },
      "123e4567-e89b-12d3-a456-426614174111",
    );
    expect(repository.createSubagent).toHaveBeenCalledWith({
      scope: {
        tenant_id: "default",
        agent_id: "123e4567-e89b-12d3-a456-426614174000",
        workspace_id: "123e4567-e89b-12d3-a456-426614174001",
      },
      subagentId: "123e4567-e89b-12d3-a456-426614174111",
      subagent: expect.objectContaining({
        execution_profile: "planner",
        session_key: "agent:default:subagent:123e4567-e89b-12d3-a456-426614174111",
      }),
    });
  });

  it("marks a subagent failed when the injected runtime port errors", async () => {
    const repository = createRepository();
    repository.createSubagent.mockResolvedValue({
      subagent_id: "123e4567-e89b-12d3-a456-426614174111",
      tenant_id: "default",
      agent_id: "123e4567-e89b-12d3-a456-426614174000",
      workspace_id: "123e4567-e89b-12d3-a456-426614174001",
      execution_profile: "executor_rw",
      session_key: "agent:default:subagent:123e4567-e89b-12d3-a456-426614174111",
      lane: "subagent",
      status: "running",
      created_at: "2026-03-19T00:00:00.000Z",
    });
    repository.markSubagentFailed.mockResolvedValue(undefined);

    const runtime: WorkboardSubagentRuntime = {
      buildSessionKey: vi
        .fn()
        .mockResolvedValue("agent:default:subagent:123e4567-e89b-12d3-a456-426614174111"),
      runTurn: vi.fn().mockRejectedValue(new Error("runtime unavailable")),
    };

    const service = new SubagentService({ repository, runtime });

    await expect(
      service.spawnAndRunSubagent({
        scope: {
          tenant_id: "default",
          agent_id: "123e4567-e89b-12d3-a456-426614174000",
          workspace_id: "123e4567-e89b-12d3-a456-426614174001",
        },
        subagent: {
          execution_profile: "executor_rw",
          lane: "subagent",
          status: "running",
        },
        message: "execute this",
      }),
    ).rejects.toThrow("runtime unavailable");

    expect(repository.markSubagentFailed).toHaveBeenCalledWith({
      scope: {
        tenant_id: "default",
        agent_id: "123e4567-e89b-12d3-a456-426614174000",
        workspace_id: "123e4567-e89b-12d3-a456-426614174001",
      },
      subagent_id: "123e4567-e89b-12d3-a456-426614174111",
      reason: "runtime unavailable",
    });
  });
});
