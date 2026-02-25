import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLifecycleHooksFromHome } from "../../src/modules/hooks/config.js";

describe("loadLifecycleHooksFromHome", () => {
  let homeDir: string | undefined;
  let logSpy: ReturnType<typeof vi.spyOn> | undefined;
  let priorLogLevel: string | undefined;

  beforeEach(() => {
    priorLogLevel = process.env["TYRUM_LOG_LEVEL"];
    process.env["TYRUM_LOG_LEVEL"] = "warn";
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    if (logSpy) {
      logSpy.mockRestore();
      logSpy = undefined;
    }
    if (priorLogLevel === undefined) {
      delete process.env["TYRUM_LOG_LEVEL"];
    } else {
      process.env["TYRUM_LOG_LEVEL"] = priorLogLevel;
    }

    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  function getHooksConfigWarnLogs(): Array<{ msg: string; path?: string }> {
    if (!logSpy) return [];
    return logSpy.mock.calls
      .map((call) => call[0])
      .filter((arg): arg is string => typeof arg === "string" && arg.startsWith("{"))
      .map((line) => {
        try {
          return JSON.parse(line) as unknown;
        } catch {
          return undefined;
        }
      })
      .filter((record): record is { msg: unknown; level: unknown; path?: unknown } => {
        return typeof record === "object" && record !== null;
      })
      .filter((record) => record.level === "warn" && typeof record.msg === "string")
      .filter((record) => record.msg.startsWith("hooks.config_"))
      .map((record) => ({
        msg: record.msg,
        path: typeof record.path === "string" ? record.path : undefined,
      }));
  }

  it("loads hooks.yml and returns allowlisted hooks", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-hooks-config-"));
    await writeFile(
      join(homeDir, "hooks.yml"),
      [
        "v: 1",
        "hooks:",
        "  - hook_key: hook:550e8400-e29b-41d4-a716-446655440000",
        "    event: command.execute",
        "    steps:",
        "      - type: CLI",
        "        args:",
        "          cmd: echo",
        '          args: ["hi"]',
        "",
      ].join("\n"),
      "utf-8",
    );

    const hooks = await loadLifecycleHooksFromHome(homeDir);
    expect(hooks).toHaveLength(1);
    expect(hooks[0]?.hook_key).toBe("hook:550e8400-e29b-41d4-a716-446655440000");
    expect(hooks[0]?.event).toBe("command.execute");
    expect(hooks[0]?.lane).toBe("cron");
    expect(hooks[0]?.steps[0]?.type).toBe("CLI");
  });

  it("accepts hooks.yml entries targeting the heartbeat lane", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-hooks-config-"));
    await writeFile(
      join(homeDir, "hooks.yml"),
      [
        "v: 1",
        "hooks:",
        "  - hook_key: hook:550e8400-e29b-41d4-a716-446655440000",
        "    event: command.execute",
        "    lane: heartbeat",
        "    steps:",
        "      - type: CLI",
        "        args:",
        "          cmd: echo",
        '          args: ["hi"]',
        "",
      ].join("\n"),
      "utf-8",
    );

    const hooks = await loadLifecycleHooksFromHome(homeDir);
    expect(hooks).toHaveLength(1);
    expect(hooks[0]?.lane).toBe("heartbeat");
  });

  it("warns and returns [] when hooks.yml contains invalid YAML", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-hooks-config-"));
    const configPath = join(homeDir, "hooks.yml");
    await writeFile(configPath, "v: 1\nhooks: [", "utf-8");

    const hooks = await loadLifecycleHooksFromHome(homeDir);
    expect(hooks).toEqual([]);

    const warns = getHooksConfigWarnLogs();
    expect(warns).toContainEqual({ msg: "hooks.config_parse_failed", path: configPath });
  });

  it("warns and returns [] when hooks.yml fails schema validation", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-hooks-config-"));
    const configPath = join(homeDir, "hooks.yml");
    await writeFile(configPath, ["v: 1", "hooks:", "  - nope: true", ""].join("\n"), "utf-8");

    const hooks = await loadLifecycleHooksFromHome(homeDir);
    expect(hooks).toEqual([]);

    const warns = getHooksConfigWarnLogs();
    expect(warns).toContainEqual({ msg: "hooks.config_validation_failed", path: configPath });
  });

  it("does not warn when no hooks config file exists", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-hooks-config-"));

    const hooks = await loadLifecycleHooksFromHome(homeDir);
    expect(hooks).toEqual([]);

    const warns = getHooksConfigWarnLogs();
    expect(warns).toHaveLength(0);
  });
});
