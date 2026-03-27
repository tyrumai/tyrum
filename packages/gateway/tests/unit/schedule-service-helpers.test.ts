import { describe, expect, it } from "vitest";
import {
  normalizeScheduleConfig,
  parseScheduleConfig,
  serializeScheduleConfig,
  defaultHeartbeatInstruction,
  defaultHeartbeatCadence,
  defaultStoredLastFiredAtMs,
  rowToScheduleRecord,
  DEFAULT_HEARTBEAT_INSTRUCTION,
} from "../../src/modules/automation/schedule-service-helpers.js";
import type {
  NormalizedScheduleConfig,
  RawScheduleRow,
} from "../../src/modules/automation/schedule-service-types.js";

describe("normalizeScheduleConfig", () => {
  it("normalizes a heartbeat config with interval cadence", () => {
    const result = normalizeScheduleConfig({
      kind: "heartbeat",
      enabled: true,
      cadence: { type: "interval", interval_ms: 60000 },
      execution: { kind: "agent_turn" },
    });

    expect(result.schedule_kind).toBe("heartbeat");
    expect(result.delivery.mode).toBe("quiet");
    expect(result.execution.kind).toBe("agent_turn");
    expect(result.enabled).toBe(true);
  });

  it("defaults enabled to true", () => {
    const result = normalizeScheduleConfig({
      kind: "cron",
      cadence: { type: "interval", interval_ms: 5000 },
      execution: { kind: "agent_turn" },
    });
    expect(result.enabled).toBe(true);
  });

  it("sets delivery mode to notify for cron schedules", () => {
    const result = normalizeScheduleConfig({
      kind: "cron",
      cadence: { type: "interval", interval_ms: 5000 },
      execution: { kind: "agent_turn" },
    });
    expect(result.delivery.mode).toBe("notify");
  });

  it("preserves explicit delivery mode", () => {
    const result = normalizeScheduleConfig({
      kind: "cron",
      cadence: { type: "interval", interval_ms: 5000 },
      execution: { kind: "agent_turn" },
      delivery: { mode: "quiet" },
    });
    expect(result.delivery.mode).toBe("quiet");
  });

  it("throws when heartbeat uses non-agent_turn execution", () => {
    expect(() =>
      normalizeScheduleConfig({
        kind: "heartbeat",
        cadence: { type: "interval", interval_ms: 5000 },
        execution: { kind: "playbook", playbook_id: "test" },
      }),
    ).toThrow("heartbeat schedules must use execution.kind='agent_turn'");
  });

  it("throws when interval_ms is non-positive", () => {
    expect(() =>
      normalizeScheduleConfig({
        kind: "cron",
        cadence: { type: "interval", interval_ms: 0 },
        execution: { kind: "agent_turn" },
      }),
    ).toThrow("positive interval_ms");
  });

  it("throws when interval_ms is NaN", () => {
    expect(() =>
      normalizeScheduleConfig({
        kind: "cron",
        cadence: { type: "interval", interval_ms: NaN },
        execution: { kind: "agent_turn" },
      }),
    ).toThrow("positive interval_ms");
  });

  it("adds default heartbeat instruction when none provided", () => {
    const result = normalizeScheduleConfig({
      kind: "heartbeat",
      cadence: { type: "interval", interval_ms: 60000 },
      execution: { kind: "agent_turn" },
    });
    expect((result.execution as { instruction?: string }).instruction).toBe(
      DEFAULT_HEARTBEAT_INSTRUCTION,
    );
  });

  it("preserves provided execution instruction", () => {
    const result = normalizeScheduleConfig({
      kind: "heartbeat",
      cadence: { type: "interval", interval_ms: 60000 },
      execution: { kind: "agent_turn", instruction: "custom check" },
    });
    expect((result.execution as { instruction?: string }).instruction).toBe("custom check");
  });

  it("normalizes playbook execution", () => {
    const result = normalizeScheduleConfig({
      kind: "cron",
      cadence: { type: "interval", interval_ms: 5000 },
      execution: { kind: "playbook", playbook_id: "  my-playbook  " },
    });
    expect(result.execution.kind).toBe("playbook");
    expect((result.execution as { playbook_id: string }).playbook_id).toBe("my-playbook");
  });

  it("throws for playbook with empty playbook_id", () => {
    expect(() =>
      normalizeScheduleConfig({
        kind: "cron",
        cadence: { type: "interval", interval_ms: 5000 },
        execution: { kind: "playbook", playbook_id: "  " },
      }),
    ).toThrow("playbook_id");
  });

  it("includes seeded_default when provided", () => {
    const result = normalizeScheduleConfig({
      kind: "heartbeat",
      cadence: { type: "interval", interval_ms: 60000 },
      execution: { kind: "agent_turn" },
      seededDefault: true,
    });
    expect(result.seeded_default).toBe(true);
  });

  it("includes key when provided", () => {
    const result = normalizeScheduleConfig({
      kind: "cron",
      cadence: { type: "interval", interval_ms: 5000 },
      execution: { kind: "agent_turn" },
      key: "  my-key  ",
    });
    expect(result.key).toBe("my-key");
  });
});

describe("parseScheduleConfig", () => {
  it("returns undefined for invalid JSON", () => {
    expect(parseScheduleConfig("not json")).toBeUndefined();
  });

  it("returns undefined for non-object JSON", () => {
    expect(parseScheduleConfig('"just a string"')).toBeUndefined();
    expect(parseScheduleConfig("42")).toBeUndefined();
    expect(parseScheduleConfig("null")).toBeUndefined();
  });

  it("parses a valid interval heartbeat config", () => {
    const config: NormalizedScheduleConfig = {
      v: 1,
      schedule_kind: "heartbeat",
      enabled: true,
      cadence: { type: "interval", interval_ms: 60000 },
      execution: { kind: "agent_turn", instruction: "check things" },
      delivery: { mode: "quiet" },
    };
    const result = parseScheduleConfig(JSON.stringify(config));
    expect(result).toBeDefined();
    expect(result!.schedule_kind).toBe("heartbeat");
    expect(result!.cadence.type).toBe("interval");
  });

  it("returns undefined for config with missing cadence", () => {
    const config = {
      v: 1,
      schedule_kind: "cron",
      enabled: true,
      execution: { kind: "agent_turn" },
    };
    expect(parseScheduleConfig(JSON.stringify(config))).toBeUndefined();
  });

  it("rejects intervalMs-only persisted schedule configs", () => {
    const config = {
      v: 1,
      intervalMs: 30000,
    };
    expect(parseScheduleConfig(JSON.stringify(config))).toBeUndefined();
  });

  it("rejects configs with legacy steps arrays outside execution", () => {
    const config = {
      v: 1,
      schedule_kind: "cron",
      cadence: { type: "interval", interval_ms: 5000 },
      steps: [{ kind: "send", text: "hello" }],
    };
    expect(parseScheduleConfig(JSON.stringify(config))).toBeUndefined();
  });

  it("rejects configs with legacy playbook_id fields", () => {
    const config = {
      v: 1,
      schedule_kind: "cron",
      cadence: { type: "interval", interval_ms: 5000 },
      playbook_id: "my-playbook",
    };
    expect(parseScheduleConfig(JSON.stringify(config))).toBeUndefined();
  });

  it("rejects configs with legacy planId fields", () => {
    const config = {
      v: 1,
      schedule_kind: "cron",
      cadence: { type: "interval", interval_ms: 5000 },
      planId: "legacy-plan-id",
    };
    expect(parseScheduleConfig(JSON.stringify(config))).toBeUndefined();
  });

  it("returns undefined for config where normalizeScheduleConfig throws", () => {
    // heartbeat with playbook execution triggers throw in normalizeScheduleConfig
    const config = {
      v: 1,
      schedule_kind: "heartbeat",
      cadence: { type: "interval", interval_ms: 5000 },
      execution: { kind: "playbook", playbook_id: "test" },
    };
    expect(parseScheduleConfig(JSON.stringify(config))).toBeUndefined();
  });

  it("returns undefined for config with empty cron expression", () => {
    const config = {
      v: 1,
      schedule_kind: "cron",
      cadence: { type: "cron", expression: "", timezone: "UTC" },
      execution: { kind: "agent_turn" },
    };
    expect(parseScheduleConfig(JSON.stringify(config))).toBeUndefined();
  });

  it("returns undefined for config with empty cron timezone", () => {
    const config = {
      v: 1,
      schedule_kind: "cron",
      cadence: { type: "cron", expression: "0 * * * *", timezone: "" },
      execution: { kind: "agent_turn" },
    };
    expect(parseScheduleConfig(JSON.stringify(config))).toBeUndefined();
  });

  it("parses enabled=false correctly", () => {
    const config: NormalizedScheduleConfig = {
      v: 1,
      schedule_kind: "cron",
      enabled: false,
      cadence: { type: "interval", interval_ms: 5000 },
      execution: { kind: "agent_turn" },
      delivery: { mode: "notify" },
    };
    const result = parseScheduleConfig(JSON.stringify(config));
    expect(result).toBeDefined();
    expect(result!.enabled).toBe(false);
  });

  it("parses delivery mode from nested delivery object", () => {
    const config = {
      v: 1,
      schedule_kind: "cron",
      cadence: { type: "interval", interval_ms: 5000 },
      execution: { kind: "agent_turn" },
      delivery: { mode: "quiet" },
    };
    const result = parseScheduleConfig(JSON.stringify(config));
    expect(result).toBeDefined();
    expect(result!.delivery.mode).toBe("quiet");
  });
});

describe("serializeScheduleConfig", () => {
  it("serializes config to JSON", () => {
    const config: NormalizedScheduleConfig = {
      v: 1,
      schedule_kind: "heartbeat",
      enabled: true,
      cadence: { type: "interval", interval_ms: 60000 },
      execution: { kind: "agent_turn" },
      delivery: { mode: "quiet" },
    };
    const json = serializeScheduleConfig(config);
    expect(JSON.parse(json)).toEqual(config);
  });
});

describe("defaultHeartbeatInstruction", () => {
  it("returns the default heartbeat instruction", () => {
    expect(defaultHeartbeatInstruction()).toBe(DEFAULT_HEARTBEAT_INSTRUCTION);
  });
});

describe("defaultHeartbeatCadence", () => {
  it("returns an interval cadence", () => {
    const cadence = defaultHeartbeatCadence();
    expect(cadence.type).toBe("interval");
    expect((cadence as { interval_ms: number }).interval_ms).toBe(30 * 60_000);
  });
});

describe("defaultStoredLastFiredAtMs", () => {
  it("returns nowMs for cron cadence", () => {
    const config = {
      v: 1 as const,
      schedule_kind: "cron" as const,
      enabled: true,
      cadence: { type: "cron" as const, expression: "0 * * * *", timezone: "UTC" },
      execution: { kind: "agent_turn" as const },
      delivery: { mode: "notify" as const },
    };
    expect(defaultStoredLastFiredAtMs(config, 1000000)).toBe(1000000);
  });

  it("returns slot-aligned value for interval cadence", () => {
    const config = {
      v: 1 as const,
      schedule_kind: "heartbeat" as const,
      enabled: true,
      cadence: { type: "interval" as const, interval_ms: 60000 },
      execution: { kind: "agent_turn" as const },
      delivery: { mode: "quiet" as const },
    };
    const result = defaultStoredLastFiredAtMs(config, 1000050);
    expect(typeof result).toBe("number");
  });
});

describe("rowToScheduleRecord", () => {
  it("returns undefined for rows with invalid config JSON", () => {
    const row: RawScheduleRow = {
      tenant_id: "t1",
      watcher_id: "w1",
      watcher_key: "wk1",
      agent_id: "a1",
      agent_key: "ak1",
      workspace_id: "ws1",
      workspace_key: "wsk1",
      trigger_type: "schedule",
      trigger_config_json: "not json",
      active: 1,
      last_fired_at_ms: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    expect(rowToScheduleRecord(row, Date.now())).toBeUndefined();
  });

  it("converts a valid row to a schedule record", () => {
    const config: NormalizedScheduleConfig = {
      v: 1,
      schedule_kind: "heartbeat",
      enabled: true,
      cadence: { type: "interval", interval_ms: 60000 },
      execution: { kind: "agent_turn", instruction: "check" },
      delivery: { mode: "quiet" },
    };
    const row: RawScheduleRow = {
      tenant_id: "t1",
      watcher_id: "w1",
      watcher_key: "wk1",
      agent_id: "a1",
      agent_key: "ak1",
      workspace_id: "ws1",
      workspace_key: "wsk1",
      trigger_type: "schedule",
      trigger_config_json: JSON.stringify(config),
      active: 1,
      last_fired_at_ms: 1000000,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };

    const record = rowToScheduleRecord(row, Date.now());
    expect(record).toBeDefined();
    expect(record!.schedule_id).toBe("w1");
    expect(record!.watcher_key).toBe("wk1");
    expect(record!.kind).toBe("heartbeat");
    expect(record!.deleted).toBe(false);
    expect(record!.seeded_default).toBe(false);
    expect(record!.target_scope.agent_key).toBe("ak1");
  });

  it("marks as deleted when active is 0", () => {
    const config: NormalizedScheduleConfig = {
      v: 1,
      schedule_kind: "heartbeat",
      enabled: true,
      cadence: { type: "interval", interval_ms: 60000 },
      execution: { kind: "agent_turn" },
      delivery: { mode: "quiet" },
    };
    const row: RawScheduleRow = {
      tenant_id: "t1",
      watcher_id: "w1",
      watcher_key: "wk1",
      agent_id: "a1",
      agent_key: "ak1",
      workspace_id: "ws1",
      workspace_key: "wsk1",
      trigger_type: "schedule",
      trigger_config_json: JSON.stringify(config),
      active: 0,
      last_fired_at_ms: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };

    const record = rowToScheduleRecord(row, Date.now());
    expect(record).toBeDefined();
    expect(record!.deleted).toBe(true);
  });

  it("normalizes Date objects in created_at/updated_at", () => {
    const config: NormalizedScheduleConfig = {
      v: 1,
      schedule_kind: "cron",
      enabled: true,
      cadence: { type: "interval", interval_ms: 5000 },
      execution: { kind: "agent_turn" },
      delivery: { mode: "notify" },
    };
    const row: RawScheduleRow = {
      tenant_id: "t1",
      watcher_id: "w1",
      watcher_key: "wk1",
      agent_id: "a1",
      agent_key: "ak1",
      workspace_id: "ws1",
      workspace_key: "wsk1",
      trigger_type: "schedule",
      trigger_config_json: JSON.stringify(config),
      active: true,
      last_fired_at_ms: null,
      created_at: new Date("2026-01-01T00:00:00Z"),
      updated_at: new Date("2026-01-02T00:00:00Z"),
    };

    const record = rowToScheduleRecord(row, Date.now());
    expect(record).toBeDefined();
    expect(record!.created_at).toBe("2026-01-01T00:00:00.000Z");
    expect(record!.updated_at).toBe("2026-01-02T00:00:00.000Z");
    expect(record!.deleted).toBe(false);
  });
});
