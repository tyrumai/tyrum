import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ContextReportDal } from "../../src/modules/context/report-dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqlDb } from "../../src/statestore/types.js";

describe("ContextReportDal", () => {
  let db: SqlDb;
  let dal: ContextReportDal;

  beforeEach(async () => {
    db = await openTestSqliteDb();
    dal = new ContextReportDal(db);
  });

  afterEach(async () => {
    await db.close();
  });

  const sampleReport = {
    system_prompt_sections: [
      { name: "rules", byte_size: 1200, token_estimate: 300 },
      { name: "tools", byte_size: 4800, token_estimate: 1200 },
    ],
    workspace_files: [
      { path: "README.md", raw_bytes: 500, injected_bytes: 500, truncated: false },
    ],
    tool_schemas: [
      { tool_name: "tool.fs.read", byte_size: 320 },
      { tool_name: "tool.http.fetch", byte_size: 480 },
    ],
    history: { message_count: 12, total_bytes: 8400 },
    tool_results: { count: 5, total_bytes: 3200 },
    total_context_bytes: 18900,
  };

  it("creates and retrieves a context report by run_id", async () => {
    const row = await dal.create("run-001", sampleReport);

    expect(row.report_id).toBeDefined();
    expect(row.run_id).toBe("run-001");
    expect(row.created_at).toBeDefined();

    const parsed = JSON.parse(row.report_json);
    expect(parsed.system_prompt_sections).toHaveLength(2);
    expect(parsed.total_context_bytes).toBe(18900);

    const fetched = await dal.getByRunId("run-001");
    expect(fetched).toBeDefined();
    expect(fetched!.report_id).toBe(row.report_id);
  });

  it("returns undefined for non-existent run_id", async () => {
    const fetched = await dal.getByRunId("no-such-run");
    expect(fetched).toBeUndefined();
  });

  it("lists all reports", async () => {
    await dal.create("run-a", sampleReport);
    await dal.create("run-b", sampleReport);
    await dal.create("run-c", sampleReport);

    const all = await dal.list();
    expect(all).toHaveLength(3);
    const runIds = all.map((r) => r.run_id).sort();
    expect(runIds).toEqual(["run-a", "run-b", "run-c"]);
  });

  it("respects limit and offset in list", async () => {
    await dal.create("run-1", sampleReport);
    await dal.create("run-2", sampleReport);
    await dal.create("run-3", sampleReport);

    const page = await dal.list(2, 0);
    expect(page).toHaveLength(2);

    const page2 = await dal.list(2, 2);
    expect(page2).toHaveLength(1);
  });

  it("stores valid JSON that round-trips correctly", async () => {
    const row = await dal.create("run-json", sampleReport);
    const parsed = JSON.parse(row.report_json);

    expect(parsed).toEqual(sampleReport);
  });
});
