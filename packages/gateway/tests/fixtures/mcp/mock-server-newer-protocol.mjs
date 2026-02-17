/* eslint-disable no-console */
// Minimal MCP stdio server fixture that negotiates a newer protocol date.

process.stdin.setEncoding("utf8");

let buffer = "";

function write(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function onRequest(msg) {
  if (!msg || typeof msg !== "object") return;
  const { id, method } = msg;
  if (method === "initialize") {
    write({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2025-01-01",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "mock-mcp-server-newer-protocol",
          version: "0.0.0",
        },
      },
    });
    return;
  }

  if (method === "tools/list") {
    write({
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "echo",
            description: "Echo back the provided text.",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
              additionalProperties: false,
            },
          },
        ],
      },
    });
    return;
  }

  write({
    jsonrpc: "2.0",
    id,
    error: {
      code: -32601,
      message: `method not found: ${method}`,
    },
  });
}

process.stdin.on("data", (chunk) => {
  buffer += chunk;
  while (true) {
    const idx = buffer.indexOf("\n");
    if (idx === -1) break;
    let line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    const trimmed = line.trim();
    if (!trimmed) continue;

    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (msg && typeof msg === "object" && msg.jsonrpc === "2.0" && msg.id !== undefined) {
      onRequest(msg);
    }
  }
});

process.on("SIGTERM", () => {
  process.exit(0);
});

setInterval(() => {}, 250).unref();

