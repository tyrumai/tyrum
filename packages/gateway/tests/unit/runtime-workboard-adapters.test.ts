import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
  IdentityScopeDal,
} from "../../src/modules/identity/scope.js";
import {
  createGatewaySessionKeyBuilder,
  createGatewaySubagentRuntime,
} from "../../src/modules/workboard/runtime-workboard-adapters.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

describe("runtime workboard adapters", () => {
  it("caches agent key lookups across repeated session key builds", async () => {
    const db = openTestSqliteDb();

    try {
      const seedDal = new IdentityScopeDal(db);
      const agentId = await seedDal.ensureAgentId(DEFAULT_TENANT_ID, "default");
      const identityScopeDal = new IdentityScopeDal(db);
      const builder = createGatewaySessionKeyBuilder({ db, identityScopeDal });
      const scope = {
        tenant_id: DEFAULT_TENANT_ID,
        agent_id: agentId,
        workspace_id: DEFAULT_WORKSPACE_ID,
      };
      const getSpy = vi.spyOn(db, "get");

      await builder.buildSessionKey(scope, "subagent-1");
      await builder.buildSessionKey(scope, "subagent-2");

      expect(getSpy).toHaveBeenCalledTimes(1);
    } finally {
      await db.close();
    }
  });

  it("caches agent key lookups across repeated subagent turns", async () => {
    const db = openTestSqliteDb();

    try {
      const seedDal = new IdentityScopeDal(db);
      const agentId = await seedDal.ensureAgentId(DEFAULT_TENANT_ID, "default");
      const identityScopeDal = new IdentityScopeDal(db);
      const runtimeTurn = vi.fn(async (input: { parts?: Array<{ text?: string }> }) => ({
        reply: input.parts?.[0]?.text ?? "",
      }));
      const runtime = createGatewaySubagentRuntime({
        db,
        identityScopeDal,
        agents: {
          getRuntime: vi.fn(async () => ({ turn: runtimeTurn })),
        } as never,
      });
      const scope = {
        tenant_id: DEFAULT_TENANT_ID,
        agent_id: agentId,
        workspace_id: DEFAULT_WORKSPACE_ID,
      };
      const getSpy = vi.spyOn(db, "get");

      await runtime.runTurn({
        scope,
        subagent: {
          subagent_id: "subagent-1",
          session_key: "agent:default:subagent:subagent-1",
          lane: "subagent",
          agent_id: agentId,
        },
        message: "hello",
      });
      await runtime.runTurn({
        scope,
        subagent: {
          subagent_id: "subagent-2",
          session_key: "agent:default:subagent:subagent-2",
          lane: "subagent",
          agent_id: agentId,
        },
        message: "again",
      });

      expect(getSpy).toHaveBeenCalledTimes(1);
      expect(runtimeTurn).toHaveBeenCalledTimes(2);
    } finally {
      await db.close();
    }
  });
});
