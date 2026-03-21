import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { gatewayApiManifest } from "../../src/api/manifest.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../../..");

const WS_PROTOCOL_SOURCES = [
  "packages/gateway/src/ws/protocol/approval-handlers.ts",
  "packages/gateway/src/ws/protocol/control-plane-handlers.ts",
  "packages/gateway/src/ws/protocol/node-handlers.ts",
  "packages/gateway/src/ws/protocol/node-runtime-handlers.ts",
  "packages/gateway/src/ws/protocol/ai-sdk-chat-ops.ts",
  "packages/gateway/src/ws/protocol/subagent-handlers.ts",
  "packages/gateway/src/ws/protocol/transcript-handlers.ts",
  "packages/gateway/src/ws/protocol/workboard-handlers.ts",
];

function collectMessageTypes(source: string): string[] {
  const messageTypes = new Set<string>();
  for (const match of source.matchAll(/msg\.type === "([^"]+)"/gu)) {
    const [, type] = match;
    if (type) {
      messageTypes.add(type);
    }
  }
  for (const match of source.matchAll(/msg\.type !== "([^"]+)"/gu)) {
    const [, type] = match;
    if (type) {
      messageTypes.add(type);
    }
  }
  for (const match of source.matchAll(/"([^"]+)":\s*createHandler\(/gu)) {
    const [, type] = match;
    if (type) {
      messageTypes.add(type);
    }
  }
  return [...messageTypes];
}

describe("Gateway WebSocket API manifest", () => {
  it("matches the supported client request surface", async () => {
    const supported = new Set(["connect.init", "connect.proof"]);

    for (const relativePath of WS_PROTOCOL_SOURCES) {
      const source = await readFile(resolve(repoRoot, relativePath), "utf8");
      for (const type of collectMessageTypes(source)) {
        supported.add(type);
      }
    }

    const expected = gatewayApiManifest.ws.requests
      .filter((request) => request.direction === "client_to_server")
      .map((request) => request.type)
      .toSorted();
    const actual = [...supported].toSorted();

    expect(actual).toEqual(expected);
  });
});
