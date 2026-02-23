import type { SqlDb } from "../../statestore/types.js";

function isMissingTableError(error: unknown, table: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const needle = table.toLowerCase();
  const haystack = message.toLowerCase();
  return (
    haystack.includes(needle) &&
    (haystack.includes("no such table") ||
      haystack.includes("does not exist") ||
      haystack.includes("relation") ||
      haystack.includes("undefined table"))
  );
}

export class PeerIdentityLinkDal {
  constructor(private readonly db: SqlDb) {}

  async resolveCanonicalPeerId(input: {
    channel: string;
    account: string;
    providerPeerId: string;
  }): Promise<string | undefined> {
    try {
      const row = await this.db.get<{ canonical_peer_id: string }>(
        `SELECT canonical_peer_id
         FROM peer_identity_links
         WHERE channel = ? AND account = ? AND provider_peer_id = ?
         LIMIT 1`,
        [input.channel, input.account, input.providerPeerId],
      );
      return row?.canonical_peer_id;
    } catch (error) {
      if (isMissingTableError(error, "peer_identity_links")) return undefined;
      throw error;
    }
  }
}

