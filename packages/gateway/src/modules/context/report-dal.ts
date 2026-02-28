import { randomUUID } from "node:crypto";
import { ContextReport } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";

export interface ContextReportRow {
  context_report_id: string;
  session_id: string;
  channel: string;
  thread_id: string;
  agent_id: string;
  workspace_id: string;
  run_id: string | null;
  report: unknown;
  created_at: string;
}

interface RawContextReportRow {
  context_report_id: string;
  session_id: string;
  channel: string;
  thread_id: string;
  agent_id: string;
  workspace_id: string;
  run_id: string | null;
  report_json: string;
  created_at: string | Date;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function parseReport(raw: string): unknown {
  try {
    const json = JSON.parse(raw) as unknown;
    const parsed = ContextReport.safeParse(json);
    return parsed.success ? parsed.data : json;
  } catch {
    // Intentional: treat invalid JSON reports as absent.
    return null;
  }
}

function toRow(raw: RawContextReportRow): ContextReportRow {
  return {
    context_report_id: raw.context_report_id,
    session_id: raw.session_id,
    channel: raw.channel,
    thread_id: raw.thread_id,
    agent_id: raw.agent_id,
    workspace_id: raw.workspace_id,
    run_id: raw.run_id,
    report: parseReport(raw.report_json),
    created_at: normalizeTime(raw.created_at),
  };
}

export class ContextReportDal {
  constructor(private readonly db: SqlDb) {}

  async insert(params: {
    contextReportId?: string;
    sessionId: string;
    channel: string;
    threadId: string;
    agentId?: string;
    workspaceId?: string;
    runId?: string | null;
    report: unknown;
    createdAtIso?: string;
  }): Promise<ContextReportRow> {
    const id = params.contextReportId?.trim() || randomUUID();
    const createdAt = params.createdAtIso ?? new Date().toISOString();

    const row = await this.db.get<RawContextReportRow>(
      `INSERT INTO context_reports (
         context_report_id,
         session_id,
         channel,
         thread_id,
         agent_id,
         workspace_id,
         run_id,
         report_json,
         created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [
        id,
        params.sessionId,
        params.channel,
        params.threadId,
        params.agentId?.trim() || "default",
        params.workspaceId?.trim() || "default",
        params.runId ?? null,
        JSON.stringify(params.report ?? null),
        createdAt,
      ],
    );
    if (!row) {
      throw new Error("context report insert failed");
    }
    return toRow(row);
  }

  async getById(contextReportId: string): Promise<ContextReportRow | undefined> {
    const row = await this.db.get<RawContextReportRow>(
      `SELECT *
       FROM context_reports
       WHERE context_report_id = ?`,
      [contextReportId],
    );
    return row ? toRow(row) : undefined;
  }

  async list(params?: {
    sessionId?: string;
    runId?: string;
    limit?: number;
  }): Promise<ContextReportRow[]> {
    const where: string[] = [];
    const values: unknown[] = [];

    if (params?.sessionId) {
      where.push("session_id = ?");
      values.push(params.sessionId);
    }
    if (params?.runId) {
      where.push("run_id = ?");
      values.push(params.runId);
    }

    const limit = Math.max(1, Math.min(500, params?.limit ?? 50));
    values.push(limit);

    const sql =
      `SELECT * FROM context_reports` +
      (where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "") +
      ` ORDER BY created_at DESC LIMIT ?`;

    const rows = await this.db.all<RawContextReportRow>(sql, values);
    return rows.map(toRow);
  }
}
