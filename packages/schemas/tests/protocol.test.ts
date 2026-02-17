import { describe, expect, it } from "vitest";
import {
  ClientMessage,
  GatewayMessage,
  requiredCapability,
} from "../src/protocol.js";

describe("ClientMessage", () => {
  it("parses hello message", () => {
    const msg = ClientMessage.parse({
      type: "hello",
      capabilities: ["playwright", "http"],
    });
    expect(msg.type).toBe("hello");
    if (msg.type === "hello") {
      expect(msg.capabilities).toEqual(["playwright", "http"]);
    }
  });

  it("parses hello message with desktop capability", () => {
    const msg = ClientMessage.parse({
      type: "hello",
      capabilities: ["desktop"],
    });
    expect(msg.type).toBe("hello");
    if (msg.type === "hello") {
      expect(msg.capabilities).toEqual(["desktop"]);
    }
  });

  it("parses task_result message", () => {
    const msg = ClientMessage.parse({
      type: "task_result",
      task_id: "task-1",
      success: true,
      evidence: { status: 200 },
    });
    expect(msg.type).toBe("task_result");
  });

  it("parses pong message", () => {
    const msg = ClientMessage.parse({ type: "pong" });
    expect(msg.type).toBe("pong");
  });
});

describe("GatewayMessage", () => {
  it("parses task_dispatch message", () => {
    const msg = GatewayMessage.parse({
      type: "task_dispatch",
      task_id: "task-1",
      plan_id: "plan-1",
      action: { type: "Http", args: { url: "https://example.com" } },
    });
    expect(msg.type).toBe("task_dispatch");
  });

  it("parses ping message", () => {
    const msg = GatewayMessage.parse({ type: "ping" });
    expect(msg.type).toBe("ping");
  });
});

describe("requiredCapability", () => {
  it("maps Web to playwright", () => {
    expect(requiredCapability("Web")).toBe("playwright");
  });

  it("maps Http to http", () => {
    expect(requiredCapability("Http")).toBe("http");
  });

  it("maps Desktop to desktop", () => {
    expect(requiredCapability("Desktop")).toBe("desktop");
  });

  it("returns undefined for Research", () => {
    expect(requiredCapability("Research")).toBeUndefined();
  });
});
