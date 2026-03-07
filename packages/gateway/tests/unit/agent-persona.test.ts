import { describe, expect, it } from "vitest";
import type { IdentityPack } from "@tyrum/schemas";
import { AgentConfig } from "@tyrum/schemas";
import {
  applyPersonaToIdentity,
  pickSeededPersonaName,
  resolveAgentPersona,
} from "../../src/modules/agent/persona.js";

describe("agent persona helpers", () => {
  it("falls back to identity fields when config.persona is missing", () => {
    const identity: IdentityPack = {
      meta: {
        name: "Tyrum Local",
        description: "Local identity",
        style: { tone: "measured", verbosity: "concise" },
      },
      body: "You are a precise local assistant.",
    };
    const config = AgentConfig.parse({
      model: { model: "openai/gpt-4.1" },
    });

    expect(
      resolveAgentPersona({
        agentKey: "default",
        config,
        identity,
      }),
    ).toEqual({
      name: "Tyrum Local",
      description: "Local identity",
      tone: "measured",
      palette: "graphite",
      character: "architect",
    });
  });

  it("overlays resolved persona onto the runtime identity prompt metadata", () => {
    const identity: IdentityPack = {
      meta: {
        name: "Tyrum Local",
        description: "Local identity",
        style: { tone: "measured", verbosity: "concise" },
      },
      body: "You are a precise local assistant.",
    };

    expect(
      applyPersonaToIdentity(identity, {
        name: "Hypatia",
        description: "Calm systems thinker.",
        tone: "direct",
        palette: "graphite",
        character: "architect",
      }),
    ).toEqual({
      meta: {
        name: "Hypatia",
        description: "Calm systems thinker.",
        style: {
          tone: "direct",
          verbosity: "concise",
        },
      },
      body: "You are a precise local assistant.",
    });
  });

  it("keeps names unique until the pool is exhausted and then adds a deterministic suffix", () => {
    expect(
      pickSeededPersonaName({
        tenantId: "tenant-1",
        agentKey: "agent-1",
        usedNames: new Set(["Alpha"]),
        candidates: ["Alpha", "Beta"],
      }),
    ).toBe("Beta");

    const exhausted = pickSeededPersonaName({
      tenantId: "tenant-1",
      agentKey: "agent-1",
      usedNames: new Set(["Alpha", "Beta"]),
      candidates: ["Alpha", "Beta"],
    });

    expect(exhausted).toMatch(/^[A-Za-z]+-[a-z0-9]{4}$/);
    expect(
      pickSeededPersonaName({
        tenantId: "tenant-1",
        agentKey: "agent-1",
        usedNames: new Set(["Alpha", "Beta"]),
        candidates: ["Alpha", "Beta"],
      }),
    ).toBe(exhausted);
  });
});
