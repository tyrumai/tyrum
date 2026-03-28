import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { SqlDb } from "../../statestore/types.js";

type RawDesktopTakeoverTokenRow = {
  conversation_id: string;
  tenant_id: string;
  environment_id: string;
  token_sha256: string;
  upstream_url: string;
  created_at: string | Date;
  expires_at: string | Date;
  last_accessed_at: string | Date;
};

export type DesktopTakeoverTokenRecord = {
  conversationId: string;
  tenantId: string;
  environmentId: string;
  upstreamUrl: string;
  createdAt: string;
  expiresAt: string;
  lastAccessedAt: string;
};

export type CreatedDesktopTakeoverToken = DesktopTakeoverTokenRecord & {
  token: string;
};

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function normalizeIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toRecord(row: RawDesktopTakeoverTokenRow): DesktopTakeoverTokenRecord {
  return {
    conversationId: row.conversation_id,
    tenantId: row.tenant_id,
    environmentId: row.environment_id,
    upstreamUrl: row.upstream_url,
    createdAt: normalizeIso(row.created_at),
    expiresAt: normalizeIso(row.expires_at),
    lastAccessedAt: normalizeIso(row.last_accessed_at),
  };
}

function generateDesktopTakeoverToken(): string {
  return randomBytes(32).toString("base64url");
}

export class DesktopTakeoverTokenDal {
  constructor(private readonly db: SqlDb) {}

  private async deleteExpiredConversations(expiresOnOrBefore: string): Promise<void> {
    await this.db.run(
      `DELETE FROM desktop_takeover_conversations
       WHERE expires_at <= ?`,
      [expiresOnOrBefore],
    );
  }

  async create(input: {
    tenantId: string;
    environmentId: string;
    upstreamUrl: string;
    expiresAt: string;
  }): Promise<CreatedDesktopTakeoverToken> {
    const token = generateDesktopTakeoverToken();
    const tokenSha256 = sha256Hex(token);
    const nowIso = new Date().toISOString();
    await this.deleteExpiredConversations(nowIso);
    const row = await this.db.get<RawDesktopTakeoverTokenRow>(
      `INSERT INTO desktop_takeover_conversations (
         conversation_id,
         tenant_id,
         environment_id,
         token_sha256,
         upstream_url,
         created_at,
         expires_at,
         last_accessed_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING conversation_id, tenant_id, environment_id, token_sha256, upstream_url, created_at,
                 expires_at, last_accessed_at`,
      [
        randomUUID(),
        input.tenantId,
        input.environmentId,
        tokenSha256,
        input.upstreamUrl,
        nowIso,
        input.expiresAt,
        nowIso,
      ],
    );
    if (!row) {
      throw new Error("failed to create desktop takeover conversation");
    }
    return { ...toRecord(row), token };
  }

  async getActiveByToken(token: string): Promise<DesktopTakeoverTokenRecord | undefined> {
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      return undefined;
    }

    const tokenSha256 = sha256Hex(trimmedToken);
    const nowIso = new Date().toISOString();
    const row = await this.db.get<RawDesktopTakeoverTokenRow>(
      `SELECT conversation_id, tenant_id, environment_id, token_sha256, upstream_url, created_at,
              expires_at, last_accessed_at
       FROM desktop_takeover_conversations
       WHERE token_sha256 = ?
         AND expires_at > ?
       LIMIT 1`,
      [tokenSha256, nowIso],
    );
    if (!row) {
      return undefined;
    }

    const accessedAt = new Date().toISOString();
    await this.db.run(
      `UPDATE desktop_takeover_conversations
       SET last_accessed_at = ?
       WHERE conversation_id = ?`,
      [accessedAt, row.conversation_id],
    );
    return {
      ...toRecord(row),
      lastAccessedAt: accessedAt,
    };
  }
}
