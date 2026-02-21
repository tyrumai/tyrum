import { describe, expect, it, afterEach } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { ArtifactMetadataDal } from "../../src/modules/artifact/metadata-dal.js";

describe("ArtifactMetadataDal", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    if (db) { await db.close(); db = undefined; }
  });

  it("insert and getById round-trip", async () => {
    db = openTestSqliteDb();
    const dal = new ArtifactMetadataDal(db);
    const row = await dal.insert({
      artifactId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      kind: "screenshot",
      uri: "artifact://aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      mimeType: "image/png",
      sizeBytes: 1024,
      labels: ["test"],
    });
    expect(row.artifact_id).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(row.kind).toBe("screenshot");
    expect(row.labels).toEqual(["test"]);

    const fetched = await dal.getById("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(fetched).toBeDefined();
    expect(fetched!.mime_type).toBe("image/png");
  });

  it("getById returns undefined for missing", async () => {
    db = openTestSqliteDb();
    const dal = new ArtifactMetadataDal(db);
    const result = await dal.getById("does-not-exist");
    expect(result).toBeUndefined();
  });

  it("listByRun filters correctly", async () => {
    db = openTestSqliteDb();
    const dal = new ArtifactMetadataDal(db);
    await dal.insert({ artifactId: "a1", runId: "r1", kind: "log", uri: "artifact://a1000000-0000-0000-0000-000000000001" });
    await dal.insert({ artifactId: "a2", runId: "r1", kind: "log", uri: "artifact://a2000000-0000-0000-0000-000000000002" });
    await dal.insert({ artifactId: "a3", runId: "r2", kind: "log", uri: "artifact://a3000000-0000-0000-0000-000000000003" });

    const r1Artifacts = await dal.listByRun("r1");
    expect(r1Artifacts).toHaveLength(2);
  });

  it("listByStep filters correctly", async () => {
    db = openTestSqliteDb();
    const dal = new ArtifactMetadataDal(db);
    await dal.insert({ artifactId: "a1", stepId: "s1", kind: "screenshot", uri: "artifact://a1000000-0000-0000-0000-000000000001" });
    await dal.insert({ artifactId: "a2", stepId: "s2", kind: "screenshot", uri: "artifact://a2000000-0000-0000-0000-000000000002" });

    const s1Artifacts = await dal.listByStep("s1");
    expect(s1Artifacts).toHaveLength(1);
    expect(s1Artifacts[0]!.artifact_id).toBe("a1");
  });
});
