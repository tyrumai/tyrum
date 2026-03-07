import { expect, it, vi } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleClientMessage } from "../../src/ws/protocol.js";
import { TaskResultRegistry } from "../../src/ws/protocol/task-result-registry.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { makeDeps, makeClient } from "./ws-protocol.test-support.js";

/**
 * Basic parsing, task.execute, and command.execute tests for handleClientMessage.
 * Must be called inside a `describe("handleClientMessage")` block.
 */
function registerParsingTests(): void {
  it("returns error for invalid JSON", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const deps = makeDeps(cm);

    const result = await handleClientMessage(client, "not json{{{", deps);
    expect(result).toBeDefined();
    expect(result!.type).toBe("error");
    const payload = (result as unknown as { payload: { code: string } }).payload;
    expect(payload.code).toBe("invalid_json");
  });

  it("returns error for invalid message schema", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const deps = makeDeps(cm);

    const result = await handleClientMessage(
      client,
      JSON.stringify({ type: "unknown_type" }),
      deps,
    );
    expect(result).toBeDefined();
    expect(result!.type).toBe("error");
    const payload = (result as unknown as { payload: { code: string } }).payload;
    expect(payload.code).toBe("invalid_message");
  });

  it("returns error response for client-sent request envelopes", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const deps = makeDeps(cm);

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "r-1",
        type: "connect",
        payload: { capabilities: ["playwright"] },
      }),
      deps,
    );
    expect(result).toBeDefined();
    expect((result as unknown as { ok: boolean }).ok).toBe(false);
    expect((result as unknown as { error: { code: string } }).error.code).toBe(
      "unsupported_request",
    );
  });
}

function registerTaskAndCommandTests(): void {
  it("dispatches task.execute response to callback", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"], { role: "node" });
    const client = cm.getClient(id)!;
    const onTaskResult = vi.fn();
    const deps = makeDeps(cm, { onTaskResult });

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "t-1",
        type: "task.execute",
        ok: true,
        result: { evidence: { screenshot: "base64..." } },
      }),
      deps,
    );

    expect(result).toBeUndefined();
    expect(onTaskResult).toHaveBeenCalledWith(
      "t-1",
      true,
      undefined,
      { screenshot: "base64..." },
      undefined,
    );
  });

  it("rejects task.execute responses from operator clients", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["playwright"]);
    const client = cm.getClient(id)!;
    const onTaskResult = vi.fn();
    const deps = makeDeps(cm, { onTaskResult });

    const result = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "t-client-1",
        type: "task.execute",
        ok: true,
        result: { evidence: { screenshot: "base64..." } },
      }),
      deps,
    );

    expect(onTaskResult).not.toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result!.type).toBe("error");
    const payload = (result as unknown as { payload: { code: string } }).payload;
    expect(payload.code).toBe("unauthorized");
  });

  it("rejects task.execute results from an unexpected connection", async () => {
    const cm = new ConnectionManager();
    const { id: expectedConnectionId } = makeClient(cm, ["cli"], { id: "conn-1", role: "node" });
    const { id: otherConnectionId } = makeClient(cm, ["cli"], { id: "conn-2", role: "node" });
    const expected = cm.getClient(expectedConnectionId)!;
    const other = cm.getClient(otherConnectionId)!;

    const taskResults = new TaskResultRegistry();
    taskResults.associate("t-expected-1", expectedConnectionId);

    const onTaskResult = vi.fn();
    const deps = makeDeps(cm, { onTaskResult, taskResults });

    const unexpected = await handleClientMessage(
      other,
      JSON.stringify({
        request_id: "t-expected-1",
        type: "task.execute",
        ok: true,
        result: { evidence: { screenshot: "base64..." } },
      }),
      deps,
    );

    expect(onTaskResult).not.toHaveBeenCalled();
    expect(unexpected).toBeDefined();
    expect(unexpected!.type).toBe("error");
    const payload = (unexpected as unknown as { payload: { code: string } }).payload;
    expect(payload.code).toBe("unauthorized");

    const result = await handleClientMessage(
      expected,
      JSON.stringify({
        request_id: "t-expected-1",
        type: "task.execute",
        ok: true,
        result: { evidence: { screenshot: "base64..." } },
      }),
      deps,
    );

    expect(result).toBeUndefined();
    expect(onTaskResult).toHaveBeenCalledOnce();
  });

  it("fires command.execute lifecycle hooks after executing a command", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["cli"]);
    const client = cm.getClient(id)!;

    const hooks = {
      fire: vi.fn(async () => undefined),
    };

    const deps = makeDeps(cm, { hooks: hooks as never });

    const res = await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "r-1",
        type: "command.execute",
        payload: { command: "/help" },
      }),
      deps,
    );

    expect(res).toBeDefined();
    expect((res as unknown as { ok: boolean }).ok).toBe(true);
    expect(hooks.fire).toHaveBeenCalledOnce();
    expect(hooks.fire.mock.calls[0]?.[0]).toMatchObject({
      event: "command.execute",
      metadata: { command: "/help" },
    });
  });

  it("passes command context to command.execute handlers", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["cli"]);
    const client = cm.getClient(id)!;

    const db = openTestSqliteDb();
    try {
      const deps = makeDeps(cm, { db });

      const res = await handleClientMessage(
        client,
        JSON.stringify({
          request_id: "r-1",
          type: "command.execute",
          payload: {
            command: "/model openai/gpt-4.1",
            channel: "ui",
            thread_id: "thread-1",
          },
        }),
        deps,
      );

      expect(res).toBeDefined();
      expect((res as unknown as { ok: boolean }).ok).toBe(true);
      expect((res as unknown as { result: { data: unknown } }).result.data).toMatchObject({
        session_id: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        ),
        model_id: "openai/gpt-4.1",
      });
    } finally {
      await db.close();
    }
  });

  it("dispatches task.execute error response", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["cli"], { role: "node" });
    const client = cm.getClient(id)!;
    const onTaskResult = vi.fn();
    const deps = makeDeps(cm, { onTaskResult });

    await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "t-2",
        type: "task.execute",
        ok: false,
        error: { code: "task_failed", message: "command failed" },
      }),
      deps,
    );

    expect(onTaskResult).toHaveBeenCalledWith("t-2", false, undefined, undefined, "command failed");
  });

  it("dispatches task.execute error response evidence from error details", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["cli"], { role: "node" });
    const client = cm.getClient(id)!;
    const onTaskResult = vi.fn();
    const deps = makeDeps(cm, { onTaskResult });

    await handleClientMessage(
      client,
      JSON.stringify({
        request_id: "t-3",
        type: "task.execute",
        ok: false,
        error: {
          code: "task_failed",
          message: "browser action failed",
          details: {
            evidence: { screenshot: "base64...", dom: "<html></html>" },
          },
        },
      }),
      deps,
    );

    expect(onTaskResult).toHaveBeenCalledWith(
      "t-3",
      false,
      undefined,
      { screenshot: "base64...", dom: "<html></html>" },
      "browser action failed",
    );
  });
}

export function registerHandleMessageBasicTests(): void {
  registerParsingTests();
  registerTaskAndCommandTests();
}
