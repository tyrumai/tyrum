import { describe, expect, it, vi } from "vitest";
import {
  SubagentService,
  type WorkboardRepository,
  type WorkboardSessionKeyBuilder,
  type WorkboardSubagentRuntime,
} from "../src/index.js";
import { TEST_SCOPE, makeSubagent } from "./test-support.js";

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

function createRuntime(): WorkboardSubagentRuntime {
  return {
    buildSessionKey: vi.fn(async (_scope, subagentId) => `agent:default:subagent:${subagentId}`),
    runTurn: vi.fn(async () => "done"),
  };
}

describe("SubagentService", () => {
  it("builds a conversation key through the injected session-key builder when one is not provided", async () => {
    const repository = createRepository();
    repository.createSubagent.mockResolvedValue(makeSubagent());

    const sessionKeyBuilder: WorkboardSessionKeyBuilder = {
      buildSessionKey: vi
        .fn()
        .mockResolvedValue("agent:default:subagent:123e4567-e89b-12d3-a456-426614174111"),
    };

    const service = new SubagentService({ repository, sessionKeyBuilder });
    await service.createSubagent({
      scope: TEST_SCOPE,
      subagentId: "123e4567-e89b-12d3-a456-426614174111",
      subagent: {
        execution_profile: "planner",
        status: "paused",
      },
    });

    expect(sessionKeyBuilder.buildSessionKey).toHaveBeenCalledWith(
      TEST_SCOPE,
      "123e4567-e89b-12d3-a456-426614174111",
    );
    expect(repository.createSubagent).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      subagentId: "123e4567-e89b-12d3-a456-426614174111",
      subagent: expect.objectContaining({
        execution_profile: "planner",
        conversation_key: "agent:default:subagent:123e4567-e89b-12d3-a456-426614174111",
      }),
    });
  });

  it("uses a provided conversation key without consulting the builder", async () => {
    const repository = createRepository();
    repository.createSubagent.mockResolvedValue(
      makeSubagent({ conversation_key: "agent:default:subagent:provided" }),
    );
    const sessionKeyBuilder: WorkboardSessionKeyBuilder = {
      buildSessionKey: vi.fn(),
    };

    const service = new SubagentService({ repository, sessionKeyBuilder });
    await service.createSubagent({
      scope: TEST_SCOPE,
      subagentId: "subagent-provided",
      subagent: {
        execution_profile: "planner",
        conversation_key: "agent:default:subagent:provided",
      },
    });

    expect(sessionKeyBuilder.buildSessionKey).not.toHaveBeenCalled();
    expect(repository.createSubagent).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      subagentId: "subagent-provided",
      subagent: expect.objectContaining({
        conversation_key: "agent:default:subagent:provided",
      }),
    });
  });

  it("requires a session key builder when no conversation key is provided", async () => {
    const service = new SubagentService({ repository: createRepository() });

    await expect(
      service.createSubagent({
        scope: TEST_SCOPE,
        subagent: {
          execution_profile: "planner",
        },
      }),
    ).rejects.toThrow("createSubagent requires session key builder");
  });

  it("returns undefined when closing a missing subagent", async () => {
    const repository = createRepository();
    repository.getSubagent.mockResolvedValue(undefined);
    const service = new SubagentService({ repository });

    await expect(
      service.closeSubagent({
        scope: TEST_SCOPE,
        subagent_id: "missing-subagent",
      }),
    ).resolves.toBeUndefined();

    expect(repository.closeSubagent).not.toHaveBeenCalled();
  });

  it("delegates closeSubagent when the subagent exists", async () => {
    const repository = createRepository();
    const subagent = makeSubagent({ subagent_id: "subagent-2" });
    repository.getSubagent.mockResolvedValue(subagent);
    repository.closeSubagent.mockResolvedValue(makeSubagent({ status: "closing" }));
    const service = new SubagentService({ repository });

    await expect(
      service.closeSubagent({
        scope: TEST_SCOPE,
        subagent_id: "subagent-2",
        reason: "Done",
      }),
    ).resolves.toEqual(expect.objectContaining({ status: "closing" }));

    expect(repository.closeSubagent).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      subagent_id: "subagent-2",
      reason: "Done",
    });
  });

  it("requires runtime access for sendSubagentMessage", async () => {
    const service = new SubagentService({ repository: createRepository() });

    await expect(
      service.sendSubagentMessage({
        scope: TEST_SCOPE,
        subagent_id: "subagent-1",
        message: "hello",
      }),
    ).rejects.toThrow("sendSubagentMessage requires agent runtime access");
  });

  it("fails when the target subagent does not exist", async () => {
    const repository = createRepository();
    repository.getSubagent.mockResolvedValue(undefined);
    const service = new SubagentService({ repository, runtime: createRuntime() });

    await expect(
      service.sendSubagentMessage({
        scope: TEST_SCOPE,
        subagent_id: "missing-subagent",
        message: "hello",
      }),
    ).rejects.toThrow("subagent not found");
  });

  it.each(["closing", "closed", "failed"] as const)(
    "rejects %s subagents before calling the runtime",
    async (status) => {
      const repository = createRepository();
      repository.getSubagent.mockResolvedValue(makeSubagent({ status }));
      const runtime = createRuntime();
      const service = new SubagentService({ repository, runtime });

      await expect(
        service.sendSubagentMessage({
          scope: TEST_SCOPE,
          subagent_id: "subagent-1",
          message: "hello",
        }),
      ).rejects.toThrow(`subagent is ${status}`);

      expect(runtime.runTurn).not.toHaveBeenCalled();
    },
  );

  it("marks paused subagents running before executing the turn", async () => {
    const repository = createRepository();
    const subagent = makeSubagent({ status: "paused" });
    repository.getSubagent.mockResolvedValue(subagent);
    repository.updateSubagent.mockResolvedValue(makeSubagent({ status: "running" }));
    const runtime = createRuntime();
    runtime.runTurn = vi.fn(async () => "reply");
    const service = new SubagentService({ repository, runtime });

    await expect(
      service.sendSubagentMessage({
        scope: TEST_SCOPE,
        subagent_id: subagent.subagent_id,
        message: "hello",
      }),
    ).resolves.toEqual({ subagent, reply: "reply" });

    expect(repository.updateSubagent).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      subagent_id: subagent.subagent_id,
      patch: { status: "running" },
    });
    expect(runtime.runTurn).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      subagent,
      message: "hello",
    });
  });

  it("marks the subagent failed when status promotion fails", async () => {
    const repository = createRepository();
    const subagent = makeSubagent({ status: "paused" });
    repository.getSubagent.mockResolvedValue(subagent);
    repository.updateSubagent.mockRejectedValue(new Error("status update failed"));
    repository.markSubagentFailed.mockResolvedValue(undefined);
    const runtime = createRuntime();
    const service = new SubagentService({ repository, runtime });

    await expect(
      service.sendSubagentMessage({
        scope: TEST_SCOPE,
        subagent_id: subagent.subagent_id,
        message: "hello",
      }),
    ).rejects.toThrow("status update failed");

    expect(repository.markSubagentFailed).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      subagent_id: subagent.subagent_id,
      reason: "status update failed",
    });
    expect(runtime.runTurn).not.toHaveBeenCalled();
  });

  it("marks the subagent failed when the runtime turn errors", async () => {
    const repository = createRepository();
    const subagent = makeSubagent({ status: "running" });
    repository.getSubagent.mockResolvedValue(subagent);
    repository.markSubagentFailed.mockResolvedValue(undefined);
    const runtime = createRuntime();
    runtime.runTurn = vi.fn().mockRejectedValue(new Error("runtime unavailable"));
    const service = new SubagentService({ repository, runtime });

    await expect(
      service.sendSubagentMessage({
        scope: TEST_SCOPE,
        subagent_id: subagent.subagent_id,
        message: "hello",
      }),
    ).rejects.toThrow("runtime unavailable");

    expect(repository.markSubagentFailed).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      subagent_id: subagent.subagent_id,
      reason: "runtime unavailable",
    });
  });

  it("uses a caller-provided subagent without reloading it", async () => {
    const repository = createRepository();
    const runtime = createRuntime();
    runtime.runTurn = vi.fn(async () => "reply");
    const subagent = makeSubagent({ status: "running" });
    const service = new SubagentService({ repository, runtime });

    await expect(
      service.sendSubagentMessage({
        scope: TEST_SCOPE,
        subagent_id: subagent.subagent_id,
        message: "hello",
        subagent,
      }),
    ).resolves.toEqual({ subagent, reply: "reply" });

    expect(repository.getSubagent).not.toHaveBeenCalled();
    expect(runtime.runTurn).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      subagent,
      message: "hello",
    });
  });

  it("closes the subagent after a successful spawnAndRunSubagent when requested", async () => {
    const repository = createRepository();
    repository.createSubagent.mockResolvedValue(makeSubagent({ status: "running" }));
    repository.markSubagentClosed.mockResolvedValue(makeSubagent({ status: "closed" }));
    const runtime = createRuntime();
    runtime.runTurn = vi.fn(async () => "done");

    const service = new SubagentService({ repository, runtime });
    const result = await service.spawnAndRunSubagent({
      scope: TEST_SCOPE,
      subagent: {
        execution_profile: "executor_rw",
        lane: "subagent",
        status: "running",
      },
      message: "execute this",
      close_on_success: true,
    });

    expect(result.reply).toBe("done");
    expect(result.subagent.status).toBe("closed");
    expect(repository.markSubagentClosed).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      subagent_id: "subagent-1",
    });
  });

  it("falls back to the created subagent when close_on_success cannot reload it", async () => {
    const repository = createRepository();
    const created = makeSubagent({ status: "running" });
    repository.createSubagent.mockResolvedValue(created);
    repository.markSubagentClosed.mockResolvedValue(undefined);
    const runtime = createRuntime();

    const service = new SubagentService({ repository, runtime });
    const result = await service.spawnAndRunSubagent({
      scope: TEST_SCOPE,
      subagent: {
        execution_profile: "executor_rw",
        lane: "subagent",
        status: "running",
      },
      message: "execute this",
      close_on_success: true,
    });

    expect(result.reply).toBe("done");
    expect(result.subagent).toEqual(created);
  });

  it("marks a subagent failed when the injected runtime port errors", async () => {
    const repository = createRepository();
    repository.createSubagent.mockResolvedValue(makeSubagent({ status: "running" }));
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
        scope: TEST_SCOPE,
        subagent: {
          execution_profile: "executor_rw",
          lane: "subagent",
          status: "running",
        },
        message: "execute this",
      }),
    ).rejects.toThrow("runtime unavailable");

    expect(repository.markSubagentFailed).toHaveBeenCalledWith({
      scope: TEST_SCOPE,
      subagent_id: "subagent-1",
      reason: "runtime unavailable",
    });
  });
});
