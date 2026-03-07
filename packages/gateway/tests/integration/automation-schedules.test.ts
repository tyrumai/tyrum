import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { wireContainer, type GatewayContainer } from "../../src/container.js";
import { createAutomationScheduleRoutes } from "../../src/routes/automation-schedules.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("automation schedule routes", () => {
  let db: SqliteDb;
  let container: GatewayContainer;
  let app: Hono;

  beforeEach(() => {
    db = openTestSqliteDb();
    container = wireContainer(db, {
      dbPath: ":memory:",
      migrationsDir: ".",
      tyrumHome: "/tmp/tyrum-test",
    });
    app = new Hono();
    app.route("/", createAutomationScheduleRoutes(container));
  });

  afterEach(async () => {
    await db.close();
  });

  it("creates, lists, pauses, and deletes schedules via HTTP", async () => {
    const createRes = await app.request("/automation/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "heartbeat",
        cadence: { type: "interval", interval_ms: 30 * 60_000 },
        execution: { kind: "agent_turn", instruction: "Review workboard state." },
        delivery: { mode: "quiet" },
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      schedule: { schedule_id: string; enabled: boolean };
    };
    expect(created.schedule.enabled).toBe(true);

    const listRes = await app.request("/automation/schedules");
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json()) as { schedules: Array<{ schedule_id: string }> };
    expect(
      listed.schedules.some((schedule) => schedule.schedule_id === created.schedule.schedule_id),
    ).toBe(true);

    const pauseRes = await app.request(
      `/automation/schedules/${String(created.schedule.schedule_id)}/pause`,
      {
        method: "POST",
      },
    );
    expect(pauseRes.status).toBe(200);
    const paused = (await pauseRes.json()) as {
      schedule: { enabled: boolean };
    };
    expect(paused.schedule.enabled).toBe(false);

    const deleteRes = await app.request(
      `/automation/schedules/${String(created.schedule.schedule_id)}`,
      {
        method: "DELETE",
      },
    );
    expect(deleteRes.status).toBe(200);
  });

  it("rejects invalid steps schedules before calling the service layer", async () => {
    const createRes = await app.request("/automation/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "cron",
        cadence: { type: "interval", interval_ms: 60_000 },
        execution: {
          kind: "steps",
          steps: [{ type: "Nope", args: {} }],
        },
      }),
    });

    expect(createRes.status).toBe(400);
    const body = (await createRes.json()) as { message: string };
    expect(body.message).toMatch(/invalid steps schedule action/i);
  });
});
