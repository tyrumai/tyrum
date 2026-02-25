import { afterEach, describe, expect, it } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { OauthPendingDal } from "../../src/modules/oauth/pending-dal.js";

describe("OauthPendingDal", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("consumes a pending row exactly once", async () => {
    db = openTestSqliteDb();
    const dal = new OauthPendingDal(db);

    await dal.create({
      state: "state-1",
      provider_id: "openai",
      agent_id: "agent-1",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      pkce_verifier: "verifier",
      redirect_uri: "http://localhost/callback",
      scopes: "scope-a",
      mode: "auth_code",
      metadata: {},
    });

    const first = await dal.consume("state-1");
    expect(first?.state).toBe("state-1");

    const second = await dal.consume("state-1");
    expect(second).toBeUndefined();

    const stillThere = await dal.get("state-1");
    expect(stillThere).toBeUndefined();
  });
});
