import { describe, expect, it } from "vitest";
import { createTestClient, jsonResponse, makeFetchMock } from "./http-client.test-support.js";

describe("createTyrumHttpClient presence modes", () => {
  it("accepts desktop and browser-node presence modes", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse({
        status: "ok",
        generated_at: "2026-02-25T00:00:00.000Z",
        entries: [
          {
            instance_id: "desktop-node-1",
            role: "node",
            host: "tyrum-desktop",
            mode: "desktop",
            last_seen_at: "2026-02-25T00:00:00.000Z",
          },
          {
            instance_id: "browser-node-1",
            role: "node",
            host: "operator-ui browser node",
            mode: "browser-node",
            last_seen_at: "2026-02-25T00:00:00.000Z",
          },
        ],
      }),
    );
    const client = createTestClient({ fetch });

    const result = await client.presence.list();

    expect(result.entries.map((entry) => entry.mode)).toEqual(["desktop", "browser-node"]);
  });
});
