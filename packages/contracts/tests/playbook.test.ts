import { describe, expect, it } from "vitest";
import { PlaybookManifest, PlaybookStep } from "../src/index.js";
import { expectRejects } from "./test-helpers.js";

describe("PlaybookStep", () => {
  const baseLlm = {
    model: "openai/gpt-4.1-mini",
    prompt: "Say hello.",
  } as const;

  it("parses an llm step with json output", () => {
    const step = PlaybookStep.parse({
      id: "step-1",
      command: "llm generate",
      llm: baseLlm,
      output: "json",
    });

    expect(step.command).toContain("llm");
  });

  it("canonicalizes legacy llm tool allowlists", () => {
    const step = PlaybookStep.parse({
      id: "step-1",
      command: "llm generate",
      llm: {
        ...baseLlm,
        tools: { allow: ["webfetch", "bash", "mcp.memory.write"] },
      },
      output: "json",
    });

    expect(step.llm?.tools?.allow).toEqual(["webfetch", "bash", "memory.write"]);
  });

  it("rejects llm steps missing llm config", () => {
    expectRejects(PlaybookStep, { id: "step-1", command: "llm generate", output: "json" });
  });

  it("rejects non-llm steps that include llm config", () => {
    expectRejects(PlaybookStep, {
      id: "step-1",
      command: "http GET https://example.com",
      llm: baseLlm,
    });
  });

  it("rejects unsupported command namespaces", () => {
    expectRejects(PlaybookStep, { id: "step-1", command: "nope do-thing" });
  });

  it("rejects output schemas when output.type is not json", () => {
    expectRejects(PlaybookStep, {
      id: "step-1",
      command: "http GET https://example.com",
      output: { type: "text", schema: true },
    });
  });

  it("rejects llm steps without json output", () => {
    expectRejects(PlaybookStep, {
      id: "step-1",
      command: "llm generate",
      llm: baseLlm,
      output: "text",
    });
  });
});

describe("PlaybookManifest", () => {
  it("rejects duplicate step ids", () => {
    const step = { id: "step-1", command: "http GET https://example.com" } as const;
    expectRejects(PlaybookManifest, {
      id: "playbook-1",
      name: "Test Playbook",
      version: "0.0.1",
      steps: [step, step],
    });
  });
});
