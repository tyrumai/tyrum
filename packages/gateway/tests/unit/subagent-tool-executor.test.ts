import { afterEach, describe, expect, it } from "vitest";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import type { AgentRegistry } from "../../src/modules/agent/registry.js";
import { executeSubagentTool } from "../../src/modules/agent/tool-executor-subagent-tools.js";
import { WorkboardDal } from "../../src/modules/workboard/dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

function extractTextFromParts(input: { parts?: Array<{ type: string; text?: string }> }): string {
  return (
    input.parts
      ?.filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n\n") ?? ""
  );
}

function createFakeAgents(): AgentRegistry {
  return {
    getRuntime: async () =>
      ({
        turn: async (input: { parts?: Array<{ type: string; text?: string }> }) => ({
          reply: `echo:${extractTextFromParts(input)}`,
        }),
      }) as Awaited<ReturnType<AgentRegistry["getRuntime"]>>,
  } as AgentRegistry;
}

describe("subagent tool executor", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("spawns session-owned helper subagents and scopes list/get to the owner", async () => {
    db = openTestSqliteDb();
    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;
    const parentSessionKey = "agent:default:test:default:channel:thread-owner";
    const otherSessionKey = "agent:default:test:default:channel:thread-other";

    const spawnResult = await executeSubagentTool(
      {
        workspaceLease: {
          db,
          tenantId: DEFAULT_TENANT_ID,
          agentId: DEFAULT_AGENT_ID,
          workspaceId: DEFAULT_WORKSPACE_ID,
        },
        agents: createFakeAgents(),
      },
      "subagent.spawn",
      "tool-call-1",
      {
        execution_profile: "explorer_ro",
        message: "inspect the repo",
      },
      { work_session_key: parentSessionKey },
    );

    const parsedSpawn = JSON.parse(spawnResult?.output ?? "{}") as {
      subagent?: { subagent_id?: string; parent_session_key?: string; execution_profile?: string };
      reply?: string;
    };
    expect(parsedSpawn.reply).toBe("echo:inspect the repo");
    expect(parsedSpawn.subagent?.execution_profile).toBe("explorer_ro");
    expect(parsedSpawn.subagent?.parent_session_key).toBe(parentSessionKey);

    const subagentId = parsedSpawn.subagent?.subagent_id;
    expect(subagentId).toBeTypeOf("string");

    const workboard = new WorkboardDal(db);
    const stored = await workboard.getSubagent({
      scope,
      subagent_id: subagentId ?? "",
    });
    expect(stored?.parent_session_key).toBe(parentSessionKey);

    const ownedList = await executeSubagentTool(
      {
        workspaceLease: {
          db,
          tenantId: DEFAULT_TENANT_ID,
          agentId: DEFAULT_AGENT_ID,
          workspaceId: DEFAULT_WORKSPACE_ID,
        },
      },
      "subagent.list",
      "tool-call-2",
      {},
      { work_session_key: parentSessionKey },
    );
    const parsedOwnedList = JSON.parse(ownedList?.output ?? "{}") as {
      subagents?: Array<{ subagent_id: string }>;
    };
    expect(parsedOwnedList.subagents?.map((subagent) => subagent.subagent_id)).toContain(
      subagentId,
    );

    const otherList = await executeSubagentTool(
      {
        workspaceLease: {
          db,
          tenantId: DEFAULT_TENANT_ID,
          agentId: DEFAULT_AGENT_ID,
          workspaceId: DEFAULT_WORKSPACE_ID,
        },
      },
      "subagent.list",
      "tool-call-3",
      {},
      { work_session_key: otherSessionKey },
    );
    const parsedOtherList = JSON.parse(otherList?.output ?? "{}") as {
      subagents?: Array<{ subagent_id: string }>;
    };
    expect(parsedOtherList.subagents ?? []).toHaveLength(0);

    const ownedGet = await executeSubagentTool(
      {
        workspaceLease: {
          db,
          tenantId: DEFAULT_TENANT_ID,
          agentId: DEFAULT_AGENT_ID,
          workspaceId: DEFAULT_WORKSPACE_ID,
        },
      },
      "subagent.get",
      "tool-call-4",
      { subagent_id: subagentId },
      { work_session_key: parentSessionKey },
    );
    const parsedOwnedGet = JSON.parse(ownedGet?.output ?? "{}") as {
      subagent?: { subagent_id?: string };
    };
    expect(parsedOwnedGet.subagent?.subagent_id).toBe(subagentId);

    const otherGet = await executeSubagentTool(
      {
        workspaceLease: {
          db,
          tenantId: DEFAULT_TENANT_ID,
          agentId: DEFAULT_AGENT_ID,
          workspaceId: DEFAULT_WORKSPACE_ID,
        },
      },
      "subagent.get",
      "tool-call-5",
      { subagent_id: subagentId },
      { work_session_key: otherSessionKey },
    );
    const parsedOtherGet = JSON.parse(otherGet?.output ?? "{}") as {
      subagent?: { subagent_id?: string };
    };
    expect(parsedOtherGet.subagent).toBeUndefined();
  });

  it("enforces read-only helper profiles and owner-only follow-up control", async () => {
    db = openTestSqliteDb();
    const parentSessionKey = "agent:default:test:default:channel:thread-owner";
    const otherSessionKey = "agent:default:test:default:channel:thread-other";

    await expect(
      executeSubagentTool(
        {
          workspaceLease: {
            db,
            tenantId: DEFAULT_TENANT_ID,
            agentId: DEFAULT_AGENT_ID,
            workspaceId: DEFAULT_WORKSPACE_ID,
          },
          agents: createFakeAgents(),
        },
        "subagent.spawn",
        "tool-call-6",
        {
          execution_profile: "executor_rw",
          message: "write code",
        },
        { work_session_key: parentSessionKey },
      ),
    ).rejects.toThrow("execution_profile must be one of");

    const spawnResult = await executeSubagentTool(
      {
        workspaceLease: {
          db,
          tenantId: DEFAULT_TENANT_ID,
          agentId: DEFAULT_AGENT_ID,
          workspaceId: DEFAULT_WORKSPACE_ID,
        },
        agents: createFakeAgents(),
      },
      "subagent.spawn",
      "tool-call-7",
      {
        execution_profile: "reviewer_ro",
        message: "review this plan",
      },
      { work_session_key: parentSessionKey },
    );
    const parsedSpawn = JSON.parse(spawnResult?.output ?? "{}") as {
      subagent?: { subagent_id?: string };
    };
    const subagentId = parsedSpawn.subagent?.subagent_id ?? "";

    await expect(
      executeSubagentTool(
        {
          workspaceLease: {
            db,
            tenantId: DEFAULT_TENANT_ID,
            agentId: DEFAULT_AGENT_ID,
            workspaceId: DEFAULT_WORKSPACE_ID,
          },
          agents: createFakeAgents(),
        },
        "subagent.send",
        "tool-call-8",
        { subagent_id: subagentId, message: "follow up" },
        { work_session_key: otherSessionKey },
      ),
    ).rejects.toThrow("subagent not found");

    const sendResult = await executeSubagentTool(
      {
        workspaceLease: {
          db,
          tenantId: DEFAULT_TENANT_ID,
          agentId: DEFAULT_AGENT_ID,
          workspaceId: DEFAULT_WORKSPACE_ID,
        },
        agents: createFakeAgents(),
      },
      "subagent.send",
      "tool-call-9",
      { subagent_id: subagentId, message: "follow up" },
      { work_session_key: parentSessionKey },
    );
    const parsedSend = JSON.parse(sendResult?.output ?? "{}") as { reply?: string };
    expect(parsedSend.reply).toBe("echo:follow up");

    const closeResult = await executeSubagentTool(
      {
        workspaceLease: {
          db,
          tenantId: DEFAULT_TENANT_ID,
          agentId: DEFAULT_AGENT_ID,
          workspaceId: DEFAULT_WORKSPACE_ID,
        },
      },
      "subagent.close",
      "tool-call-10",
      { subagent_id: subagentId, reason: "done" },
      { work_session_key: parentSessionKey },
    );
    const parsedClose = JSON.parse(closeResult?.output ?? "{}") as {
      subagent?: { status?: string };
    };
    expect(parsedClose.subagent?.status).toBe("closing");
  });
});
