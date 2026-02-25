import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createWebUiRoutes, type WebUiDeps } from "../../src/routes/web-ui.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { ApprovalDal } from "../../src/modules/approval/dal.js";
import { MemoryDal } from "../../src/modules/memory/dal.js";
import { CanvasDal } from "../../src/modules/canvas/dal.js";

describe("/app/session", () => {
  let db: ReturnType<typeof openTestSqliteDb>;

  beforeEach(() => {
    db = openTestSqliteDb();
  });

  afterEach(async () => {
    await db.close();
  });

  it("renders a unified session timeline with lane filters and queue visibility", async () => {
    const key = "agent:default:telegram:default:channel:thread-123";
    const lane = "main";
    const threadId = "thread-123";
    const nowMs = Date.now();

    await db.run(
      `INSERT INTO lane_queue_mode_overrides (key, lane, queue_mode, updated_at_ms)
       VALUES (?, ?, ?, ?)`,
      [key, lane, "collect", nowMs],
    );

    const queuedPayload = {
      thread: { id: threadId, kind: "channel", title: "Test" },
      message: {
        id: "msg-queued",
        thread_id: threadId,
        source: "telegram",
        content: { kind: "text", text: "Queued hello" },
        timestamp: new Date(nowMs - 2000).toISOString(),
      },
    };

    await db.run(
      `INSERT INTO channel_inbox (
         source,
         thread_id,
         message_id,
         key,
         lane,
         received_at_ms,
         payload_json,
         status,
         attempt,
         queue_mode
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "telegram",
        threadId,
        "msg-queued",
        key,
        lane,
        nowMs - 2000,
        JSON.stringify(queuedPayload),
        "queued",
        0,
        "collect",
      ],
    );

    const completedPayload = {
      thread: { id: threadId, kind: "channel", title: "Test" },
      message: {
        id: "msg-done",
        thread_id: threadId,
        source: "telegram",
        content: { kind: "text", text: "Completed hello" },
        timestamp: new Date(nowMs - 4000).toISOString(),
      },
    };

    await db.run(
      `INSERT INTO channel_inbox (
         source,
         thread_id,
         message_id,
         key,
         lane,
         received_at_ms,
         payload_json,
         status,
         attempt,
         processed_at,
         reply_text,
         queue_mode
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "telegram",
        threadId,
        "msg-done",
        key,
        lane,
        nowMs - 4000,
        JSON.stringify(completedPayload),
        "completed",
        1,
        new Date(nowMs - 3000).toISOString(),
        "Assistant reply",
        "collect",
      ],
    );

    const jobId = "job-1";
    const runId = "run-1";
    const stepId = "step-1";
    const attemptId = "attempt-1";

    await db.run(
      `INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json)
       VALUES (?, ?, ?, ?, ?)`,
      [jobId, key, lane, "running", JSON.stringify({ kind: "manual" })],
    );

    await db.run(
      `INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt, created_at, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        runId,
        jobId,
        key,
        lane,
        "running",
        1,
        new Date(nowMs - 3500).toISOString(),
        new Date(nowMs - 3400).toISOString(),
      ],
    );

    await db.run(
      `INSERT INTO execution_steps (step_id, run_id, step_index, status, action_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        stepId,
        runId,
        0,
        "running",
        JSON.stringify({ type: "Decide", args: {} }),
        new Date(nowMs - 3300).toISOString(),
      ],
    );

    await db.run(
      `INSERT INTO execution_attempts (attempt_id, step_id, attempt, status, started_at)
       VALUES (?, ?, ?, ?, ?)`,
      [attemptId, stepId, 1, "running", new Date(nowMs - 3200).toISOString()],
    );

    const approvalDal = new ApprovalDal(db);
    const approval = await approvalDal.create({
      planId: "plan-1",
      stepIndex: 0,
      prompt: "Need approval",
      key,
      lane,
      runId,
    });

    await db.run(
      `INSERT INTO execution_artifacts (artifact_id, run_id, step_id, attempt_id, kind, uri, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        "artifact-1",
        runId,
        stepId,
        attemptId,
        "screenshot",
        "artifact://artifact-1",
        new Date(nowMs - 3100).toISOString(),
      ],
    );

    const deps: WebUiDeps = {
      approvalDal,
      memoryDal: new MemoryDal(db),
      watcherProcessor: {} as WebUiDeps["watcherProcessor"],
      canvasDal: new CanvasDal(db),
      playbooks: [],
      playbookRunner: {} as WebUiDeps["playbookRunner"],
      isLocalOnly: true,
      db,
    };

    const app = createWebUiRoutes(deps);
    const res = await app.request(`/app/session?key=${encodeURIComponent(key)}&lanes=main`);

    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain("Session Timeline");
    expect(html).toContain("Lane filters");
    expect(html).toContain("Queue visibility");

    expect(html).toContain("Queued hello");
    expect(html).toContain("Assistant reply");

    expect(html).toContain(runId);
    expect(html).toContain(stepId);
    expect(html).toContain(attemptId);
    expect(html).toContain(String(approval.id));
    expect(html).toContain("artifact-1");
  });

  it("filters timeline items by lane", async () => {
    const key = "agent:default:telegram:default:channel:thread-123";
    const threadId = "thread-123";
    const nowMs = Date.now();

    const payloadFor = (messageId: string, text: string) => ({
      thread: { id: threadId, kind: "channel", title: "Test" },
      message: {
        id: messageId,
        thread_id: threadId,
        source: "telegram",
        content: { kind: "text", text },
        timestamp: new Date(nowMs).toISOString(),
      },
    });

    await db.run(
      `INSERT INTO channel_inbox (source, thread_id, message_id, key, lane, received_at_ms, payload_json, status, attempt, queue_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "telegram",
        threadId,
        "msg-main",
        key,
        "main",
        nowMs - 2000,
        JSON.stringify(payloadFor("msg-main", "Main hello")),
        "queued",
        0,
        "collect",
      ],
    );

    await db.run(
      `INSERT INTO channel_inbox (source, thread_id, message_id, key, lane, received_at_ms, payload_json, status, attempt, queue_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "telegram",
        threadId,
        "msg-subagent",
        key,
        "subagent",
        nowMs - 1000,
        JSON.stringify(payloadFor("msg-subagent", "Subagent hello")),
        "queued",
        0,
        "collect",
      ],
    );

    await db.run(
      `INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json)
       VALUES (?, ?, ?, ?, ?)`,
      ["job-main", key, "main", "running", JSON.stringify({ kind: "manual" })],
    );
    await db.run(
      `INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json)
       VALUES (?, ?, ?, ?, ?)`,
      ["job-subagent", key, "subagent", "running", JSON.stringify({ kind: "manual" })],
    );

    await db.run(
      `INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["run-main", "job-main", key, "main", "running", 1, new Date(nowMs - 1500).toISOString()],
    );
    await db.run(
      `INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        "run-subagent",
        "job-subagent",
        key,
        "subagent",
        "running",
        1,
        new Date(nowMs - 1200).toISOString(),
      ],
    );

    const deps: WebUiDeps = {
      approvalDal: new ApprovalDal(db),
      memoryDal: new MemoryDal(db),
      watcherProcessor: {} as WebUiDeps["watcherProcessor"],
      canvasDal: new CanvasDal(db),
      playbooks: [],
      playbookRunner: {} as WebUiDeps["playbookRunner"],
      isLocalOnly: true,
      db,
    };

    const app = createWebUiRoutes(deps);

    const onlyMain = await app.request(`/app/session?key=${encodeURIComponent(key)}&lanes=main`);
    expect(onlyMain.status).toBe(200);
    const mainHtml = await onlyMain.text();
    expect(mainHtml).toContain("Main hello");
    expect(mainHtml).toContain("run-main");
    expect(mainHtml).not.toContain("Subagent hello");
    expect(mainHtml).not.toContain("run-subagent");

    const onlySubagent = await app.request(
      `/app/session?key=${encodeURIComponent(key)}&lanes=subagent`,
    );
    expect(onlySubagent.status).toBe(200);
    const subHtml = await onlySubagent.text();
    expect(subHtml).toContain("Subagent hello");
    expect(subHtml).toContain("run-subagent");
    expect(subHtml).not.toContain("Main hello");
    expect(subHtml).not.toContain("run-main");
  });

  it("renders correct lanes for steps and attempts even when run results are truncated", async () => {
    const key = "agent:default:telegram:default:channel:thread-123";
    const nowMs = Date.now();

    for (let i = 0; i < 200; i += 1) {
      const jobId = `job-main-${i}`;
      const runId = `run-main-${i}`;
      const createdAt = new Date(nowMs - i).toISOString();

      await db.run(
        `INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json)
         VALUES (?, ?, ?, ?, ?)`,
        [jobId, key, "main", "running", JSON.stringify({ kind: "manual" })],
      );

      await db.run(
        `INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [runId, jobId, key, "main", "running", 1, createdAt],
      );
    }

    const oldJobId = "job-subagent-old";
    const oldRunId = "run-subagent-old";
    const stepId = "step-subagent-late";
    const attemptId = "attempt-subagent-late";

    await db.run(
      `INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json)
       VALUES (?, ?, ?, ?, ?)`,
      [oldJobId, key, "subagent", "running", JSON.stringify({ kind: "manual" })],
    );
    await db.run(
      `INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        oldRunId,
        oldJobId,
        key,
        "subagent",
        "running",
        1,
        new Date(nowMs - 1000 * 60 * 60).toISOString(),
      ],
    );
    await db.run(
      `INSERT INTO execution_steps (step_id, run_id, step_index, status, action_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        stepId,
        oldRunId,
        0,
        "running",
        JSON.stringify({ type: "Decide", args: {} }),
        new Date(nowMs + 1000).toISOString(),
      ],
    );
    await db.run(
      `INSERT INTO execution_attempts (attempt_id, step_id, attempt, status, started_at)
       VALUES (?, ?, ?, ?, ?)`,
      [attemptId, stepId, 1, "running", new Date(nowMs + 2000).toISOString()],
    );

    const deps: WebUiDeps = {
      approvalDal: new ApprovalDal(db),
      memoryDal: new MemoryDal(db),
      watcherProcessor: {} as WebUiDeps["watcherProcessor"],
      canvasDal: new CanvasDal(db),
      playbooks: [],
      playbookRunner: {} as WebUiDeps["playbookRunner"],
      isLocalOnly: true,
      db,
    };

    const app = createWebUiRoutes(deps);
    const res = await app.request(
      `/app/session?key=${encodeURIComponent(key)}&lanes=main&lanes=subagent`,
    );

    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toMatch(
      new RegExp(`<td>subagent</td>\\s*<td>step</td>\\s*<td><pre><code>[^<]*${stepId}`),
    );
    expect(html).toMatch(
      new RegExp(`<td>subagent</td>\\s*<td>attempt</td>\\s*<td><pre><code>[^<]*${attemptId}`),
    );
  });

  it("treats approvals with a null lane as main for lane filtering", async () => {
    const key = "agent:default:telegram:default:channel:thread-123";

    const approvalDal = new ApprovalDal(db);
    const approval = await approvalDal.create({
      planId: "plan-1",
      stepIndex: 0,
      prompt: "Needs approval (null lane)",
      key,
      runId: "run-1",
    });

    const deps: WebUiDeps = {
      approvalDal,
      memoryDal: new MemoryDal(db),
      watcherProcessor: {} as WebUiDeps["watcherProcessor"],
      canvasDal: new CanvasDal(db),
      playbooks: [],
      playbookRunner: {} as WebUiDeps["playbookRunner"],
      isLocalOnly: true,
      db,
    };

    const app = createWebUiRoutes(deps);
    const res = await app.request(`/app/session?key=${encodeURIComponent(key)}&lanes=main`);

    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain(String(approval.id));
    expect(html).toContain("Needs approval (null lane)");
  });

  it("renders a query error banner when DB queries fail", async () => {
    const key = "agent:default:telegram:default:channel:thread-123";

    const failingDb = {
      all: async (sql: string) => {
        if (sql.includes("FROM lane_queue_mode_overrides")) {
          throw new Error("simulated query failure");
        }
        return [];
      },
    } as unknown as WebUiDeps["db"];

    const deps: WebUiDeps = {
      approvalDal: new ApprovalDal(db),
      memoryDal: new MemoryDal(db),
      watcherProcessor: {} as WebUiDeps["watcherProcessor"],
      canvasDal: new CanvasDal(db),
      playbooks: [],
      playbookRunner: {} as WebUiDeps["playbookRunner"],
      isLocalOnly: true,
      db: failingDb,
    };

    const app = createWebUiRoutes(deps);
    const res = await app.request(`/app/session?key=${encodeURIComponent(key)}&lanes=main`);

    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain("DB query errors");
    expect(html).toContain("lane_queue_mode_overrides");
    expect(html).toContain("simulated query failure");
  });
});
