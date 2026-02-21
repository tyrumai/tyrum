import { ContextReport } from "@tyrum/schemas";
import type { ContextReport as ContextReportT } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";

interface RawContextReportRow {
  context_report_id: string;
  plan_id: string;
  session_id: string | null;
  run_id: string | null;
  created_at: string | Date;
  report_json: string;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toContextReport(row: RawContextReportRow): ContextReportT {
  const parsed = ContextReport.safeParse(JSON.parse(row.report_json) as unknown);
  if (!parsed.success) {
    throw new Error(`invalid context report stored in DB (${row.context_report_id}): ${parsed.error.message}`);
  }
  // Column timestamps are treated as source-of-truth for list ordering.
  return {
    ...parsed.data,
    context_report_id: row.context_report_id,
    plan_id: row.plan_id,
    session_id: row.session_id ?? undefined,
    run_id: row.run_id ?? undefined,
    created_at: normalizeTime(row.created_at),
  };
}

export class ContextReportDal {
  constructor(private readonly db: SqlDb) {}

  async upsert(report: ContextReportT): Promise<void> {
    const json = JSON.stringify(report);
    await this.db.run(
      `INSERT INTO context_reports (
         context_report_id,
         plan_id,
         session_id,
         run_id,
         created_at,
         report_json
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (plan_id) DO UPDATE SET
         context_report_id = excluded.context_report_id,
         session_id = excluded.session_id,
         run_id = excluded.run_id,
         created_at = excluded.created_at,
         report_json = excluded.report_json`,
      [
        report.context_report_id,
        report.plan_id,
        report.session_id ?? null,
        report.run_id ?? null,
        report.created_at,
        json,
      ],
    );
  }

  async getById(contextReportId: string): Promise<ContextReportT | undefined> {
    const row = await this.db.get<RawContextReportRow>(
      `SELECT context_report_id, plan_id, session_id, run_id, created_at, report_json
       FROM context_reports
       WHERE context_report_id = ?`,
      [contextReportId],
    );
    return row ? toContextReport(row) : undefined;
  }

  async getByPlanId(planId: string): Promise<ContextReportT | undefined> {
    const row = await this.db.get<RawContextReportRow>(
      `SELECT context_report_id, plan_id, session_id, run_id, created_at, report_json
       FROM context_reports
       WHERE plan_id = ?`,
      [planId],
    );
    return row ? toContextReport(row) : undefined;
  }

  async list(opts?: { limit?: number; sessionId?: string }): Promise<ContextReportT[]> {
    const limit = Math.max(1, Math.min(200, opts?.limit ?? 50));
    const sessionId = opts?.sessionId?.trim();

    const rows = sessionId
      ? await this.db.all<RawContextReportRow>(
          `SELECT context_report_id, plan_id, session_id, run_id, created_at, report_json
           FROM context_reports
           WHERE session_id = ?
           ORDER BY created_at DESC
           LIMIT ${String(limit)}`,
          [sessionId],
        )
      : await this.db.all<RawContextReportRow>(
          `SELECT context_report_id, plan_id, session_id, run_id, created_at, report_json
           FROM context_reports
           ORDER BY created_at DESC
           LIMIT ${String(limit)}`,
        );

    return rows.map(toContextReport);
  }

  async latest(sessionId?: string): Promise<ContextReportT | undefined> {
    const rows = await this.list({ limit: 1, sessionId });
    return rows[0];
  }
}

