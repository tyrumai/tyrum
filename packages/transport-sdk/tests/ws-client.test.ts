import { describe, afterEach, vi } from "vitest";
import type { TyrumClient } from "../src/ws-client.js";
import type { TestServer } from "./ws-client.test-support.js";
import { registerConnectionTests } from "./ws-client.connection-test-support.js";
import { registerEventsTests } from "./ws-client.events-test-support.js";
import { registerControlPlaneTests } from "./ws-client.control-plane-test-support.js";
import { registerWorkTests } from "./ws-client.work-test-support.js";
import { registerMemorySubagentTests } from "./ws-client.memory-subagent-test-support.js";
import { registerDedupResponseTests } from "./ws-client.dedup-response-test-support.js";
import { registerReconnectTests } from "./ws-client.reconnect-test-support.js";

describe("TyrumClient", () => {
  let server: TestServer | undefined;
  let client: TyrumClient | undefined;

  const fixture = {
    getServer: () => server,
    setServer: (s: TestServer) => {
      server = s;
    },
    getClient: () => client,
    setClient: (c: TyrumClient) => {
      client = c;
    },
  };

  afterEach(async () => {
    client?.disconnect();
    client = undefined;
    if (server) {
      await server.close();
      server = undefined;
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  registerConnectionTests(fixture);
  registerEventsTests(fixture);
  registerControlPlaneTests(fixture);
  registerWorkTests(fixture);
  registerMemorySubagentTests(fixture);
  registerDedupResponseTests(fixture);
  registerReconnectTests(fixture);
});
