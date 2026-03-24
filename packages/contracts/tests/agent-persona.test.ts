import { describe, expect, it } from "vitest";
import {
  CODEX_AGENT_NAMES,
  DEFAULT_PERSONA_TONE_INSTRUCTIONS,
  PERSONA_CHARACTERS,
  PERSONA_PALETTES,
  PERSONA_TONES,
  PERSONA_TONE_PRESETS,
  randomizePersona,
  resolvePersonaToneInstructions,
} from "../src/index.js";

describe("agent persona helpers", () => {
  it("exports the approved persona pools", () => {
    expect(CODEX_AGENT_NAMES[0]).toBe("Euclid");
    expect(PERSONA_TONES).toContain("curious");
    expect(PERSONA_TONE_PRESETS[0]?.label).toBe("Direct and concise");
    expect(PERSONA_PALETTES).toContain("graphite");
    expect(PERSONA_CHARACTERS).toContain("operator");
  });

  it("randomizes persona fields without reusing blocked names", () => {
    const randomized = randomizePersona({
      current: {
        name: "Alpha",
        tone: "direct",
        palette: "graphite",
        character: "operator",
      },
      usedNames: ["Archimedes"],
    });

    expect(randomized.name).toBe("Euclid");
    expect(randomized.tone).toBe("curious");
    expect(randomized.palette).toBe("moss");
    expect(randomized.character).toBe("researcher");
  });

  it("expands legacy tone keys into richer instructions", () => {
    expect(resolvePersonaToneInstructions("warm")).toContain("Be warm and supportive.");
    expect(resolvePersonaToneInstructions("steady")).toContain("Stay calm, organized");
  });

  it("keeps custom tone instructions and falls back to the default preset", () => {
    expect(
      resolvePersonaToneInstructions("Explain clearly. Prefer short paragraphs over bullet lists."),
    ).toBe("Explain clearly. Prefer short paragraphs over bullet lists.");
    expect(resolvePersonaToneInstructions("")).toBe(DEFAULT_PERSONA_TONE_INSTRUCTIONS);
  });
});
