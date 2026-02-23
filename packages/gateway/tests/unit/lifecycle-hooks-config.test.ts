import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLifecycleHooksFromHome } from "../../src/modules/hooks/config.js";

describe("loadLifecycleHooksFromHome", () => {
  let homeDir: string | undefined;

  afterEach(async () => {
    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

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
        "          args: [\"hi\"]",
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
});

