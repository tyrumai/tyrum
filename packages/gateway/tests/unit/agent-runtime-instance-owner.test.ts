import { afterEach, describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { loadConfig } from "../../src/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

describe("AgentRuntime instance ownership", () => {
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await container?.db.close();
    container = undefined;
    delete process.env["TYRUM_INSTANCE_ID"];
  });

  it("prefers gatewayConfig runtime.instanceId over process.env", async () => {
    process.env["TYRUM_INSTANCE_ID"] = "env-instance";

    const gatewayConfig = loadConfig({
      GATEWAY_TOKEN: "test-token",
      TYRUM_INSTANCE_ID: "cfg-instance",
    });

    container = createContainer({ dbPath: ":memory:", migrationsDir }, { gatewayConfig });

    const { AgentRuntime } = await import("../../src/modules/agent/runtime.js");
    const runtime = new AgentRuntime({ container });

    expect((runtime as unknown as { instanceOwner: string }).instanceOwner).toBe("cfg-instance");
  });
});
