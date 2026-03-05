import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SqlDb } from "../../src/statestore/types.js";
import { VectorDal } from "../../src/modules/memory/vector-dal.js";
import { openTestPostgresDb } from "../helpers/postgres-db.js";
import { DEFAULT_AGENT_ID, DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

describe("VectorDal (postgres)", () => {
  let db: SqlDb;
  let closeDb: () => Promise<void> = async () => {};
  let dal: VectorDal;
  const defaultScope = { tenantId: DEFAULT_TENANT_ID, agentId: DEFAULT_AGENT_ID };

  beforeEach(async () => {
    const opened = await openTestPostgresDb();
    db = opened.db;
    closeDb = opened.close;
    dal = new VectorDal(db);
  });

  afterEach(async () => {
    await closeDb();
  });

  it("inserts and lists embeddings", async () => {
    await dal.insertEmbedding("first", [1, 0], "model", undefined, defaultScope);
    await dal.insertEmbedding("second", [0, 1], "model", undefined, defaultScope);

    const rows = await dal.list(defaultScope);
    expect(rows.map((r) => r.label)).toEqual(["second", "first"]);
    expect(typeof rows[0]!.id).toBe("number");
  });

  it("searchByCosineSimilarity returns vectors with ids", async () => {
    await dal.insertEmbedding("north", [1, 0, 0], "model", undefined, defaultScope);
    await dal.insertEmbedding("east", [0, 1, 0], "model", undefined, defaultScope);

    const results = await dal.searchByCosineSimilarity([1, 0, 0], 1, defaultScope);
    expect(results[0]!.row.label).toBe("north");
    expect(typeof results[0]!.row.id).toBe("number");
  });
});
