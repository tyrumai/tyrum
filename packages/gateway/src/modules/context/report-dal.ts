/**
 * Data access layer for context reports — stores what the model
 * "saw" for each execution run (system prompt sizes, workspace files,
 * tool schemas, history, and tool-result contributions).
 */

import { randomUUID } from "node:crypto";
import type { SqlDb } from "../../statestore/types.js";

export interface ContextReportRow {
  report_id: string;
  run_id: string;
  report_json: string;
  created_at: string;
}

export class ContextReportDal {
  constructor(private readonly db: SqlDb) {}

  async create(
    runId: string,
    reportData: unknown,
  ): Promise<ContextReportRow> {
    const reportId = randomUUID();
    const reportJson = JSON.stringify(reportData);
    const row = await this.db.get<ContextReportRow>(
      `INSERT INTO context_reports (report_id, run_id, report_json)
       VALUES (?, ?, ?)
       RETURNING *`,
      [reportId, runId, reportJson],
    );
    if (!row) throw new Error("context report insert failed");
    return row;
  }

  async getByRunId(runId: string): Promise<ContextReportRow | undefined> {
    return await this.db.get<ContextReportRow>(
      "SELECT * FROM context_reports WHERE run_id = ?",
      [runId],
    );
  }

  async list(
    limit = 50,
    offset = 0,
  ): Promise<ContextReportRow[]> {
    return await this.db.all<ContextReportRow>(
      "SELECT * FROM context_reports ORDER BY created_at DESC LIMIT ? OFFSET ?",
      [limit, offset],
    );
  }
}
