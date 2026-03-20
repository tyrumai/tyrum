import { describe, expect, it } from "vitest";
import {
  AgentAttachmentConfig,
  AgentModelConfig,
  AgentTurnRequest,
  AgentTurnResponse,
  ManagedAgentCreateRequest,
  ManagedAgentUpdateRequest,
} from "../src/index.js";
import { expectRejects } from "./test-helpers.js";

describe("AgentAttachmentConfig", () => {
  it("defaults attachment input mode to helper", () => {
    const parsed = AgentAttachmentConfig.parse({});

    expect(parsed.input_mode).toBe("helper");
  });

  it("accepts native attachment input mode", () => {
    const parsed = AgentAttachmentConfig.parse({
      input_mode: "native",
    });

    expect(parsed.input_mode).toBe("native");
  });
});

describe("AgentModelConfig", () => {
  it("accepts a null model when no dependent fields are set", () => {
    const parsed = AgentModelConfig.parse({
      model: null,
      options: {},
      fallback: [],
    });

    expect(parsed.model).toBeNull();
    expect(parsed.options).toEqual({});
    expect(parsed.fallback).toEqual([]);
  });

  it("rejects variants without a primary model", () => {
    expectRejects(AgentModelConfig, {
      model: null,
      variant: "fast",
    });
  });

  it("rejects non-empty options without a primary model", () => {
    expectRejects(AgentModelConfig, {
      model: null,
      options: {
        temperature: 0.2,
      },
    });
  });

  it("rejects fallback models without a primary model", () => {
    expectRejects(AgentModelConfig, {
      model: null,
      fallback: ["openai/gpt-4.1-mini"],
    });
  });
});

describe("AgentTurnRequest inline content", () => {
  it("accepts inline requests with channel, thread_id, and parts", () => {
    const parsed = AgentTurnRequest.parse({
      channel: "telegram",
      thread_id: "chat-123",
      parts: [
        { type: "text", text: "inspect this image" },
        {
          type: "file",
          mediaType: "image/png",
          url: "https://gateway.example.test/a/abc123",
          filename: "capture.png",
        },
      ],
      metadata: {
        source: "operator-ui",
      },
    });

    expect(parsed.parts).toHaveLength(2);
    expect(parsed.metadata).toEqual({ source: "operator-ui" });
  });
});

describe("ManagedAgentRequest preprocessors", () => {
  const baseConfig = {
    model: {
      model: "openai/gpt-5.4",
    },
  } as const;

  it("strips legacy identity fields from managed agent create payloads", () => {
    const parsed = ManagedAgentCreateRequest.parse({
      agent_key: "builder",
      config: baseConfig,
      identity: {
        meta: {
          name: "Legacy",
        },
      },
    });

    expect(parsed.agent_key).toBe("builder");
    expect(parsed.config.model.model).toBe("openai/gpt-5.4");
    expect("identity" in parsed).toBe(false);
  });

  it("strips legacy identity fields from managed agent update payloads", () => {
    const parsed = ManagedAgentUpdateRequest.parse({
      config: baseConfig,
      identity: {
        meta: {
          name: "Legacy",
        },
      },
    });

    expect(parsed.config.model.model).toBe("openai/gpt-5.4");
    expect("identity" in parsed).toBe(false);
  });

  it("still rejects non-object managed agent payloads", () => {
    expectRejects(ManagedAgentCreateRequest, ["not-an-object"]);
  });
});

describe("AgentTurnResponse", () => {
  it("defaults optional response fields", () => {
    const parsed = AgentTurnResponse.parse({
      reply: "done",
      session_id: "550e8400-e29b-41d4-a716-446655440000",
      session_key: "agent:assistant:main",
    });

    expect(parsed.attachments).toEqual([]);
    expect(parsed.used_tools).toEqual([]);
    expect(parsed.memory_written).toBe(false);
  });
});
