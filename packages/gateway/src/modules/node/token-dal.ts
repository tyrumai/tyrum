import { createHash, randomBytes } from "node:crypto";
import type { ClientCapability } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";

export interface NodeTokenRecord {
  token_id: number;
  node_id: string;
  token_hash: string;
  capabilities: ClientCapability[];
  issued_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  metadata: unknown;
}

interface RawNodeTokenRow {
  token_id: number;
  node_id: string;
  token_hash: string;
  capabilities_json: string;
  issued_at: string | Date;
  expires_at: string | Date | null;
  revoked_at: string | Date | null;
  metadata_json: string;
}

function normalizeTime(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function parseJsonOr<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf-8").digest("hex");
}

function toRecord(row: RawNodeTokenRow): NodeTokenRecord {
  const capabilities = parseJsonOr<ClientCapability[]>(row.capabilities_json, []);
  return {
    token_id: row.token_id,
    node_id: row.node_id,
    token_hash: row.token_hash,
    capabilities,
    issued_at: normalizeTime(row.issued_at) ?? new Date().toISOString(),
    expires_at: normalizeTime(row.expires_at),
    revoked_at: normalizeTime(row.revoked_at),
    metadata: parseJsonOr<unknown>(row.metadata_json, {}),
  };
}

export class NodeTokenDal {
  constructor(private readonly db: SqlDb) {}

  hashToken(token: string): string {
    return sha256Hex(token);
  }

  async issueToken(params: {
    nodeId: string;
    capabilities: readonly ClientCapability[];
    metadata?: unknown;
    nowIso?: string;
  }): Promise<{ token: string; record: NodeTokenRecord }> {
    const token = randomBytes(32).toString("hex");
    const tokenHash = sha256Hex(token);
    const nowIso = params.nowIso ?? new Date().toISOString();

    const row = await this.db.get<RawNodeTokenRow>(
      `INSERT INTO node_tokens (
         node_id,
         token_hash,
         capabilities_json,
         issued_at,
         metadata_json
       ) VALUES (?, ?, ?, ?, ?)
       RETURNING
         token_id,
         node_id,
         token_hash,
         capabilities_json,
         issued_at,
         expires_at,
         revoked_at,
         metadata_json`,
      [
        params.nodeId,
        tokenHash,
        JSON.stringify(params.capabilities),
        nowIso,
        JSON.stringify(params.metadata ?? {}),
      ],
    );
    if (!row) {
      throw new Error("node token insert failed");
    }
    return { token, record: toRecord(row) };
  }

  async findActiveByToken(token: string): Promise<NodeTokenRecord | undefined> {
    const tokenHash = sha256Hex(token);
    const row = await this.db.get<RawNodeTokenRow>(
      `SELECT
         token_id,
         node_id,
         token_hash,
         capabilities_json,
         issued_at,
         expires_at,
         revoked_at,
         metadata_json
       FROM node_tokens
       WHERE token_hash = ?
         AND revoked_at IS NULL`,
      [tokenHash],
    );
    return row ? toRecord(row) : undefined;
  }

  async revokeAllForNode(params: { nodeId: string; nowIso?: string }): Promise<number> {
    const nowIso = params.nowIso ?? new Date().toISOString();
    const result = await this.db.run(
      `UPDATE node_tokens
       SET revoked_at = ?
       WHERE node_id = ?
         AND revoked_at IS NULL`,
      [nowIso, params.nodeId],
    );
    return result.changes;
  }
}

