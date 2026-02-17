// Mock MCP server that never responds to any request.
// Used to test timeout / failed-start cleanup in McpStdioClient.

process.stdin.setEncoding("utf8");
process.stdin.resume();

process.on("SIGTERM", () => {
  process.exit(0);
});
