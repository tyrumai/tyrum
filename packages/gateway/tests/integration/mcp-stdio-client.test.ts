import { afterEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import type { McpServerSpec as McpServerSpecT } from "@tyrum/schemas";
import { McpStdioClient } from "../../src/modules/agent/mcp-stdio-client.js";

const mockServerPath = fileURLToPath(
  new URL("../fixtures/mcp/mock-server.mjs", import.meta.url),
);

const unresponsiveServerPath = fileURLToPath(
  new URL("../fixtures/mcp/mock-server-unresponsive.mjs", import.meta.url),
);

function makeSpec(overrides: Partial<McpServerSpecT> = {}): McpServerSpecT {
  return {
    id: "test",
    name: "Test MCP",
    enabled: true,
    transport: "stdio",
    command: process.execPath,
    args: [mockServerPath],
    timeout_ms: 2_000,
    ...overrides,
  };
}

describe("McpStdioClient", () => {
  let client: McpStdioClient | undefined;

  afterEach(async () => {
    if (client) {
      await client.stop();
      client = undefined;
    }
  });

  it("cleans up spawned process when start() fails (no process leak)", async () => {
    const spec = makeSpec({
      args: [unresponsiveServerPath],
      timeout_ms: 200,
    });
    client = new McpStdioClient(spec);

    // start() should reject because the initialize handshake times out.
    await expect(client.start()).rejects.toThrow(/timed out/);

    // After the fix, the process is already killed by the catch handler.
    // stop() should complete quickly and idempotently.
    await client.stop();

    // A retry with a working server should succeed without leftover state.
    const workingSpec = makeSpec();
    const retryClient = new McpStdioClient(workingSpec);
    await retryClient.start();
    const result = await retryClient.toolsList();
    expect(result.tools.length).toBeGreaterThan(0);
    await retryClient.stop();
  });

  it("start() succeeds with a well-behaved server", async () => {
    client = new McpStdioClient(makeSpec());
    await client.start();
    const result = await client.toolsList();
    expect(result.tools.map((t) => t.name)).toContain("echo");
  });

  it("clears buffer and stderrTail on stop so restart is not corrupted", async () => {
    client = new McpStdioClient(makeSpec());
    await client.start();

    // Simulate a partial JSON-RPC write left in buffer (as if the server
    // crashed mid-line) and stale stderr content.
    const internal = client as unknown as { buffer: string; stderrTail: string };
    internal.buffer = '{"jsonrpc":"2.0","id":99,"res';
    internal.stderrTail = "stale stderr from dead process";

    await client.stop();

    // After stop, both buffers must be cleared.
    expect(internal.buffer).toBe("");
    expect(internal.stderrTail).toBe("");

    // Restart with the same client instance must succeed: the stale partial
    // line must not corrupt the new initialize handshake.
    await client.start();
    const result = await client.toolsList();
    expect(result.tools.map((t) => t.name)).toContain("echo");
  });
});
