import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SqlDb } from "../../src/statestore/types.js";
import { VectorDal } from "../../src/modules/memory/vector-dal.js";
import { openTestPostgresDb } from "../helpers/postgres-db.js";

describe("VectorDal (postgres)", () => {
  let db: SqlDb;
  let closeDb: () => Promise<void> = async () => {};
  let dal: VectorDal;

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
    await dal.insertEmbedding("first", [1, 0], "model");
    await dal.insertEmbedding("second", [0, 1], "model");

    const rows = await dal.list();
    expect(rows.map((r) => r.label)).toEqual(["second", "first"]);
    expect(typeof rows[0]!.id).toBe("number");
  });

  it("searchByCosineSimilarity returns vectors with ids", async () => {
    await dal.insertEmbedding("north", [1, 0, 0], "model");
    await dal.insertEmbedding("east", [0, 1, 0], "model");

    const results = await dal.searchByCosineSimilarity([1, 0, 0], 1);
    expect(results[0]!.row.label).toBe("north");
    expect(typeof results[0]!.row.id).toBe("number");
  });
});
