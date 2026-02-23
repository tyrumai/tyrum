import { describe, expect, it } from "vitest";
import { PeerIdentityLinkDal } from "../../src/modules/channels/peer-identity-link-dal.js";
import type { SqlDb } from "../../src/statestore/types.js";

function makeThrowingDb(error: unknown): SqlDb {
  const db: SqlDb = {
    kind: "postgres",
    get: async () => {
      throw error;
    },
    all: async () => [],
    run: async () => ({ changes: 0 }),
    exec: async () => {},
    transaction: async (fn) => await fn(db),
    close: async () => {},
  };
  return db;
}

describe("PeerIdentityLinkDal", () => {
  describe("resolveCanonicalPeerId", () => {
    it("returns undefined when the table is missing (sqlite)", async () => {
      const dal = new PeerIdentityLinkDal(
        makeThrowingDb(new Error("SQLITE_ERROR: no such table: peer_identity_links")),
      );

      await expect(
        dal.resolveCanonicalPeerId({
          channel: "telegram",
          account: "work",
          providerPeerId: "123",
        }),
      ).resolves.toBeUndefined();
    });

    it("returns undefined when the table is missing (postgres)", async () => {
      const dal = new PeerIdentityLinkDal(
        makeThrowingDb(new Error('relation "peer_identity_links" does not exist')),
      );

      await expect(
        dal.resolveCanonicalPeerId({
          channel: "telegram",
          account: "work",
          providerPeerId: "123",
        }),
      ).resolves.toBeUndefined();
    });

    it("throws when access is denied to the relation", async () => {
      const dal = new PeerIdentityLinkDal(
        makeThrowingDb(new Error("permission denied for relation peer_identity_links")),
      );

      await expect(
        dal.resolveCanonicalPeerId({
          channel: "telegram",
          account: "work",
          providerPeerId: "123",
        }),
      ).rejects.toThrow(/permission denied/i);
    });
  });
});

