/* eslint-disable no-console */
// Minimal MCP stdio server fixture for tests.
//
// Protocol: newline-delimited JSON-RPC 2.0 over stdin/stdout.

process.stdin.setEncoding("utf8");

let buffer = "";
let initialized = false;

function write(obj) {
  const line = JSON.stringify(obj);
  process.stdout.write(`${line}\n`);
}

function onRequest(msg) {
  if (!msg || typeof msg !== "object") return;
  const { id, method, params } = msg;
  if (method === "initialize") {
    write({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "mock-mcp-server",
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

  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments ?? {};
    if (name === "echo") {
      write({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: String(args.text ?? "") }],
          isError: false,
        },
      });
      return;
    }

    write({
      jsonrpc: "2.0",
      id,
      result: {
        content: [{ type: "text", text: "unknown tool" }],
        isError: true,
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

function onNotification(msg) {
  if (!msg || typeof msg !== "object") return;
  if (msg.method === "initialized") {
    initialized = true;
  }
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
    if (msg && typeof msg === "object" && msg.jsonrpc === "2.0") {
      if (msg.id !== undefined) onRequest(msg);
      else onNotification(msg);
    }
  }
});

process.on("SIGTERM", () => {
  process.exit(0);
});

// Keep process alive.
setInterval(() => {
  if (!initialized) return;
}, 250).unref();

