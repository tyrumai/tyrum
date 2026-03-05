import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stableJsonStringify } from "../../src/modules/policy/canonical-json.js";
import { PolicySnapshotDal } from "../../src/modules/policy/snapshot-dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

describe("stableJsonStringify", () => {
  it("sorts object keys recursively", () => {
    expect(stableJsonStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(stableJsonStringify({ a: { d: 1, c: 2 } })).toBe('{"a":{"c":2,"d":1}}');
  });

  it("sorts keys deterministically (locale-independent)", () => {
    expect(stableJsonStringify({ ä: 2, z: 1 })).toBe('{"z":1,"ä":2}');
  });

  it("sorts keys inside objects nested in arrays", () => {
    expect(stableJsonStringify([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });
});

describe("PolicySnapshotDal canonical hashing", () => {
  let db: ReturnType<typeof openTestSqliteDb> | undefined;

  beforeEach(() => {
    db = openTestSqliteDb();
  });

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("dedupes snapshots for equivalent bundles regardless of key order", async () => {
    const dal = new PolicySnapshotDal(db!);

    const bundleA = {
      v: 1 as const,
      tools: {
        default: "require_approval" as const,
        allow: ["tool.fs.read"],
        require_approval: [],
        deny: [],
      },
      provenance: {
        untrusted_shell_requires_approval: true,
      },
    };

    const bundleB = {
      provenance: {
        untrusted_shell_requires_approval: true,
      },
      tools: {
        deny: [],
        require_approval: [],
        allow: ["tool.fs.read"],
        default: "require_approval" as const,
      },
      v: 1 as const,
    };

    const s1 = await dal.getOrCreate(DEFAULT_TENANT_ID, bundleA);
    const s2 = await dal.getOrCreate(DEFAULT_TENANT_ID, bundleB);

    expect(s2.policy_snapshot_id).toBe(s1.policy_snapshot_id);
    expect(s2.sha256).toBe(s1.sha256);
  });
});
