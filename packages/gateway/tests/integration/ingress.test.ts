import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createIngressRoutes } from "../../src/routes/ingress.js";

describe("POST /ingress/telegram", () => {
  const app = new Hono();
  app.route("/", createIngressRoutes());

  it("normalizes a simple text message", async () => {
    const update = {
      update_id: 100,
      message: {
        message_id: 42,
        date: 1700000000,
        from: {
          id: 999,
          is_bot: false,
          first_name: "Alice",
          username: "alice",
        },
        chat: {
          id: 123,
          type: "private",
        },
        text: "Hello bot",
      },
    };

    const res = await app.request("/ingress/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      thread: { id: string; kind: string };
      message: {
        id: string;
        source: string;
        content: { kind: string; text: string };
      };
    };
    expect(body.thread.id).toBe("123");
    expect(body.thread.kind).toBe("private");
    expect(body.message.id).toBe("42");
    expect(body.message.source).toBe("telegram");
    expect(body.message.content.kind).toBe("text");
    expect(body.message.content.text).toBe("Hello bot");
  });

  it("returns 400 for empty body", async () => {
    const res = await app.request("/ingress/telegram", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "",
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for update without message", async () => {
    const res = await app.request("/ingress/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ update_id: 101 }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("normalization_error");
  });

  it("normalizes an edited message", async () => {
    const update = {
      update_id: 102,
      edited_message: {
        message_id: 50,
        date: 1700000000,
        edit_date: 1700000060,
        chat: {
          id: 456,
          type: "group",
          title: "Test Group",
        },
        text: "Edited text",
      },
    };

    const res = await app.request("/ingress/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      thread: { kind: string; title: string };
      message: { content: { text: string }; edited_timestamp: string };
    };
    expect(body.thread.kind).toBe("group");
    expect(body.message.content.text).toBe("Edited text");
    expect(body.message.edited_timestamp).toBeDefined();
  });
});
