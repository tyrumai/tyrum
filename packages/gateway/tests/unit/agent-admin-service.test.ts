import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentConfig } from "@tyrum/contracts";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import {
  DEFAULT_AGENT_KEY,
  DEFAULT_TENANT_ID,
  IdentityScopeDal,
} from "../../src/modules/identity/scope.js";
import { AgentAdminService } from "../../src/modules/agent/admin-service.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

describe("AgentAdminService", () => {
  let db: SqliteDb;
  let identityScopeDal: IdentityScopeDal;
  let service: AgentAdminService;

  beforeEach(() => {
    db = openTestSqliteDb();
    identityScopeDal = new IdentityScopeDal(db);
    service = new AgentAdminService({
      db,
      identityScopeDal,
      stateMode: "local",
    });
  });

  afterEach(async () => {
    await db.close();
  });

  it("creates a primary agent, renames it, and deletes the demoted default agent", async () => {
    const config = AgentConfig.parse({
      model: { model: "openrouter/openai/gpt-5.4" },
      persona: {
        name: "Ops Agent",
        tone: "direct",
        palette: "graphite",
        character: "architect",
      },
    });

    const created = await service.create({
      tenantId: DEFAULT_TENANT_ID,
      agentKey: "ops-agent",
      config,
      isPrimary: true,
      reason: "test create",
    });

    await db.run(
      `INSERT INTO oauth_pending (
         tenant_id,
         state,
         provider_id,
         agent_key,
         created_at,
         expires_at,
         pkce_verifier,
         redirect_uri,
         scopes,
         mode,
         metadata_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        "oauth-state-1",
        "provider-1",
        "ops-agent",
        "2026-03-20T00:00:00.000Z",
        "2026-03-21T00:00:00.000Z",
        "verifier",
        "http://example.test/callback",
        "[]",
        "login",
        "{}",
      ],
    );

    const renamed = await service.rename({
      tenantId: DEFAULT_TENANT_ID,
      agentKey: "ops-agent",
      nextAgentKey: "ops-renamed",
      reason: "test rename",
    });
    const deleted = await service.delete({
      tenantId: DEFAULT_TENANT_ID,
      agentKey: DEFAULT_AGENT_KEY,
    });

    const oauthPending = await db.get<{ agent_key: string }>(
      "SELECT agent_key FROM oauth_pending WHERE tenant_id = ? AND state = ?",
      [DEFAULT_TENANT_ID, "oauth-state-1"],
    );
    const remainingDefault = await db.get<{ agent_id: string }>(
      "SELECT agent_id FROM agents WHERE tenant_id = ? AND agent_key = ?",
      [DEFAULT_TENANT_ID, DEFAULT_AGENT_KEY],
    );

    expect(created.is_primary).toBe(true);
    expect(created.agent_key).toBe("ops-agent");
    expect(renamed?.agent_key).toBe("ops-renamed");
    expect(await identityScopeDal.resolvePrimaryAgentKey(DEFAULT_TENANT_ID)).toBe("ops-renamed");
    expect(oauthPending?.agent_key).toBe("ops-renamed");
    expect(deleted).toMatchObject({
      agent_key: DEFAULT_AGENT_KEY,
      deleted: true,
    });
    expect(remainingDefault).toBeUndefined();
  });
});
