import { describe, expect, it } from "vitest";
import {
  CODEX_AGENT_NAMES,
  PERSONA_CHARACTERS,
  PERSONA_PALETTES,
  PERSONA_TONES,
  randomizePersona,
} from "../src/index.js";

describe("agent persona helpers", () => {
  it("exports the approved persona pools", () => {
    expect(CODEX_AGENT_NAMES[0]).toBe("Euclid");
    expect(PERSONA_TONES).toContain("curious");
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
});
