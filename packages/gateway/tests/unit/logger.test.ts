import { afterEach, describe, expect, it, vi } from "vitest";
import { Logger } from "../../src/modules/observability/logger.js";

describe("Logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits structured JSON with the existing ts/level/msg shape", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = new Logger({ level: "info", base: { service: "tyrum-gateway" } });

    logger.info("gateway.started", { request_id: "req-1" });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const record = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(record).toMatchObject({
      ts: expect.any(String),
      level: "info",
      msg: "gateway.started",
      service: "tyrum-gateway",
      request_id: "req-1",
    });
  });

  it("preserves child field merging and per-call overrides", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = new Logger({
      level: "debug",
      base: { service: "tyrum-gateway", scope: "root" },
    });

    logger.child({ scope: "child", worker: "scheduler" }).warn("schedule.delayed", {
      scope: "override",
      delay_ms: 250,
    });

    const record = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(record).toMatchObject({
      level: "warn",
      msg: "schedule.delayed",
      service: "tyrum-gateway",
      scope: "override",
      worker: "scheduler",
      delay_ms: 250,
    });
  });

  it("respects the silent level", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = new Logger({ level: "silent", base: { service: "tyrum-gateway" } });

    logger.error("should.not.emit", { request_id: "req-2" });

    expect(logSpy).not.toHaveBeenCalled();
  });

  it("serializes Error fields without stacks by default", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = new Logger({ level: "error", base: { service: "tyrum-gateway" } });

    logger.error("gateway.failed", { error: new Error("boom") });

    const record = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as Record<string, unknown>;
    const error = record["error"] as Record<string, unknown>;
    expect(error).toMatchObject({
      type: "Error",
      message: "boom",
    });
    expect(error).not.toHaveProperty("stack");
  });

  it("includes Error stacks when logStackTraces is enabled", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = new Logger({
      level: "error",
      base: { service: "tyrum-gateway" },
      logStackTraces: true,
    });

    logger.error("gateway.failed", { error: new Error("boom") });

    const record = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as Record<string, unknown>;
    const error = record["error"] as Record<string, unknown>;
    expect(error).toMatchObject({
      type: "Error",
      message: "boom",
      stack: expect.stringContaining("Error: boom"),
    });
  });
});
