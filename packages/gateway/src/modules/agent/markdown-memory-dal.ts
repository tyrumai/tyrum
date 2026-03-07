import type { SqlDb } from "../../statestore/types.js";
import { normalizeDbDateTime } from "../../utils/db-time.js";
import { DEFAULT_CORE_MEMORY_MD } from "./home.js";

export interface MarkdownMemoryDocRow {
  tenant_id: string;
  agent_id: string;
  doc_kind: "core" | "daily";
  doc_key: string;
  content_md: string;
  created_at: string | Date;
  updated_at: string | Date;
}

export type MarkdownMemoryDoc = {
  tenantId: string;
  agentId: string;
  docKind: "core" | "daily";
  docKey: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

function rowToDoc(row: MarkdownMemoryDocRow): MarkdownMemoryDoc {
  return {
    tenantId: row.tenant_id,
    agentId: row.agent_id,
    docKind: row.doc_kind,
    docKey: row.doc_key,
    content: row.content_md,
    createdAt: normalizeDbDateTime(row.created_at),
    updatedAt: normalizeDbDateTime(row.updated_at),
  };
}

export class MarkdownMemoryDal {
  constructor(private readonly db: SqlDb) {}

  async ensureCoreDoc(params: { tenantId: string; agentId: string }): Promise<MarkdownMemoryDoc> {
    const existing = await this.getDoc({
      tenantId: params.tenantId,
      agentId: params.agentId,
      docKind: "core",
      docKey: "MEMORY",
    });
    if (existing) return existing;

    return await this.putDoc({
      tenantId: params.tenantId,
      agentId: params.agentId,
      docKind: "core",
      docKey: "MEMORY",
      content: DEFAULT_CORE_MEMORY_MD,
    });
  }

  async getDoc(params: {
    tenantId: string;
    agentId: string;
    docKind: "core" | "daily";
    docKey: string;
  }): Promise<MarkdownMemoryDoc | undefined> {
    const row = await this.db.get<MarkdownMemoryDocRow>(
      `SELECT tenant_id, agent_id, doc_kind, doc_key, content_md, created_at, updated_at
       FROM agent_markdown_memory_docs
       WHERE tenant_id = ? AND agent_id = ? AND doc_kind = ? AND doc_key = ?
       LIMIT 1`,
      [params.tenantId, params.agentId, params.docKind, params.docKey],
    );
    return row ? rowToDoc(row) : undefined;
  }

  async listDocs(params: {
    tenantId: string;
    agentId: string;
    docKind?: "core" | "daily";
    limit?: number;
  }): Promise<MarkdownMemoryDoc[]> {
    const limit =
      typeof params.limit === "number" && Number.isFinite(params.limit)
        ? Math.max(1, Math.min(500, Math.floor(params.limit)))
        : 200;

    const values: unknown[] = [params.tenantId, params.agentId];
    const clauses = ["tenant_id = ?", "agent_id = ?"];
    if (params.docKind) {
      clauses.push("doc_kind = ?");
      values.push(params.docKind);
    }
    values.push(limit);

    const rows = await this.db.all<MarkdownMemoryDocRow>(
      `SELECT tenant_id, agent_id, doc_kind, doc_key, content_md, created_at, updated_at
       FROM agent_markdown_memory_docs
       WHERE ${clauses.join(" AND ")}
       ORDER BY doc_kind ASC, doc_key DESC
       LIMIT ?`,
      values,
    );
    return rows.map(rowToDoc);
  }

  async putDoc(params: {
    tenantId: string;
    agentId: string;
    docKind: "core" | "daily";
    docKey: string;
    content: string;
    occurredAtIso?: string;
  }): Promise<MarkdownMemoryDoc> {
    const timestamp = params.occurredAtIso ?? new Date().toISOString();
    await this.db.run(
      `INSERT INTO agent_markdown_memory_docs (
         tenant_id,
         agent_id,
         doc_kind,
         doc_key,
         content_md,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, agent_id, doc_kind, doc_key)
       DO UPDATE SET
         content_md = excluded.content_md,
         updated_at = excluded.updated_at`,
      [
        params.tenantId,
        params.agentId,
        params.docKind,
        params.docKey,
        params.content,
        timestamp,
        timestamp,
      ],
    );

    const persisted = await this.getDoc(params);
    if (!persisted) {
      throw new Error("markdown memory doc upsert failed");
    }
    return persisted;
  }

  async appendDoc(params: {
    tenantId: string;
    agentId: string;
    docKind: "core" | "daily";
    docKey: string;
    suffix: string;
    occurredAtIso?: string;
  }): Promise<MarkdownMemoryDoc> {
    const timestamp = params.occurredAtIso ?? new Date().toISOString();
    await this.db.run(
      `INSERT INTO agent_markdown_memory_docs (
         tenant_id,
         agent_id,
         doc_kind,
         doc_key,
         content_md,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, agent_id, doc_kind, doc_key)
       DO UPDATE SET
         content_md = agent_markdown_memory_docs.content_md || excluded.content_md,
         updated_at = excluded.updated_at`,
      [
        params.tenantId,
        params.agentId,
        params.docKind,
        params.docKey,
        params.suffix,
        timestamp,
        timestamp,
      ],
    );

    const persisted = await this.getDoc(params);
    if (!persisted) {
      throw new Error("markdown memory doc append failed");
    }
    return persisted;
  }
}
