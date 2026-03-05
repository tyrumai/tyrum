import { describe, expect, it } from "vitest";
import { SessionDal } from "../../src/modules/agent/session-dal.js";
import { ChannelThreadDal } from "../../src/modules/channels/thread-dal.js";
import { IdentityScopeDal } from "../../src/modules/identity/scope.js";
import { openTestPostgresDb } from "../helpers/postgres-db.js";

describe("SessionDal.list (postgres)", () => {
  it("treats malformed turns_json as empty instead of failing the whole query", async () => {
    const { db, close } = await openTestPostgresDb();
    try {
      const identityScopeDal = new IdentityScopeDal(db, { cacheTtlMs: 60_000 });
      const channelThreadDal = new ChannelThreadDal(db);
      const dal = new SessionDal(db, identityScopeDal, channelThreadDal);
      const s1 = await dal.getOrCreate({
        connectorKey: "ui",
        providerThreadId: "thread-1",
        containerKind: "group",
      });
      const s2 = await dal.getOrCreate({
        connectorKey: "ui",
        providerThreadId: "thread-2",
        containerKind: "group",
      });

      await db.run("UPDATE sessions SET turns_json = ? WHERE tenant_id = ? AND session_id = ?", [
        "{ not: json",
        s1.tenant_id,
        s1.session_id,
      ]);

      const page = await dal.list({ connectorKey: "ui", limit: 10 });
      expect(page.sessions.map((s) => s.session_id).sort()).toEqual(
        [s1.session_key, s2.session_key].sort(),
      );

      const corrupted = page.sessions.find((s) => s.session_id === s1.session_key);
      expect(corrupted?.turns_count).toBe(0);
      expect(corrupted?.last_turn).toBeNull();
    } finally {
      await close();
    }
  });

  it("treats non-array turns_json as empty instead of failing the whole query", async () => {
    const { db, close } = await openTestPostgresDb();
    try {
      const identityScopeDal = new IdentityScopeDal(db, { cacheTtlMs: 60_000 });
      const channelThreadDal = new ChannelThreadDal(db);
      const dal = new SessionDal(db, identityScopeDal, channelThreadDal);
      const s1 = await dal.getOrCreate({
        connectorKey: "ui",
        providerThreadId: "thread-1",
        containerKind: "group",
      });
      const s2 = await dal.getOrCreate({
        connectorKey: "ui",
        providerThreadId: "thread-2",
        containerKind: "group",
      });

      await db.run("UPDATE sessions SET turns_json = ? WHERE tenant_id = ? AND session_id = ?", [
        "{}",
        s1.tenant_id,
        s1.session_id,
      ]);

      const page = await dal.list({ connectorKey: "ui", limit: 10 });
      expect(page.sessions.map((s) => s.session_id).sort()).toEqual(
        [s1.session_key, s2.session_key].sort(),
      );

      const corrupted = page.sessions.find((s) => s.session_id === s1.session_key);
      expect(corrupted?.turns_count).toBe(0);
      expect(corrupted?.last_turn).toBeNull();
    } finally {
      await close();
    }
  });
});
