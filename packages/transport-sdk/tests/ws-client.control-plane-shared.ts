import { TyrumClient } from "../src/ws-client.js";
import {
  type TestServer,
  acceptConnect,
  createTestServer,
  delay,
} from "./ws-client.test-support.js";

export type ControlPlaneFixture = {
  getServer: () => TestServer | undefined;
  setServer: (s: TestServer) => void;
  getClient: () => TyrumClient | undefined;
  setClient: (c: TyrumClient) => void;
};

export type ControlPlaneSocket = Awaited<ReturnType<TestServer["waitForClient"]>>;

export async function connectControlPlaneClient(input: {
  fixture: ControlPlaneFixture;
  capabilities?: string[];
}): Promise<{ client: TyrumClient; ws: ControlPlaneSocket }> {
  const server = createTestServer();
  input.fixture.setServer(server);
  const client = new TyrumClient({
    url: server.url,
    token: "t",
    capabilities: input.capabilities ?? [],
    reconnect: false,
  });
  input.fixture.setClient(client);

  client.connect();
  const ws = await server.waitForClient();
  await acceptConnect(ws);
  await delay(10);

  return { client, ws };
}
