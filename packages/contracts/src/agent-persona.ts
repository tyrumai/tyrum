import type { AgentPersona } from "./agent.js";

export const CODEX_AGENT_NAMES = [
  "Euclid",
  "Archimedes",
  "Ptolemy",
  "Hypatia",
  "Avicenna",
  "Averroes",
  "Aquinas",
  "Copernicus",
  "Kepler",
  "Galileo",
  "Bacon",
  "Descartes",
  "Pascal",
  "Fermat",
  "Huygens",
  "Leibniz",
  "Newton",
  "Halley",
  "Euler",
  "Lagrange",
  "Laplace",
  "Volta",
  "Gauss",
  "Ampere",
  "Faraday",
  "Darwin",
  "Lovelace",
  "Boole",
  "Pasteur",
  "Maxwell",
  "Mendel",
  "Curie",
  "Planck",
  "Tesla",
  "Poincare",
  "Noether",
  "Hilbert",
  "Einstein",
  "Raman",
  "Bohr",
  "Turing",
  "Hubble",
  "Feynman",
  "Franklin",
  "McClintock",
  "Meitner",
  "Herschel",
  "Linnaeus",
  "Wegener",
  "Chandrasekhar",
  "Sagan",
  "Goodall",
  "Carson",
  "Carver",
  "Socrates",
  "Plato",
  "Aristotle",
  "Epicurus",
  "Cicero",
  "Confucius",
  "Mencius",
  "Zeno",
  "Locke",
  "Hume",
  "Kant",
  "Hegel",
  "Kierkegaard",
  "Mill",
  "Nietzsche",
  "Peirce",
  "James",
  "Dewey",
  "Russell",
  "Popper",
  "Sartre",
  "Beauvoir",
  "Arendt",
  "Rawls",
  "Singer",
  "Anscombe",
  "Parfit",
  "Kuhn",
  "Boyle",
  "Hooke",
  "Harvey",
  "Dalton",
  "Ohm",
  "Helmholtz",
  "Gibbs",
  "Lorentz",
  "Schrodinger",
  "Heisenberg",
  "Pauli",
  "Dirac",
  "Bernoulli",
  "Godel",
  "Nash",
  "Banach",
  "Ramanujan",
  "Erdos",
] as const;

export const PERSONA_TONES = ["direct", "curious", "measured", "warm", "wry", "steady"] as const;
export const PERSONA_TONE_PRESETS = [
  {
    key: "direct",
    label: "Direct and concise",
    description: "Lead with the answer and keep wording tight.",
    instructions:
      "Be direct and concise. Lead with the answer, keep wording tight, and avoid filler unless extra detail is clearly useful.",
  },
  {
    key: "curious",
    label: "Curious and exploratory",
    description: "Surface useful questions and next angles to check.",
    instructions:
      "Be curious and exploratory. Surface useful questions, alternatives, and next areas to investigate when they would improve the result.",
  },
  {
    key: "measured",
    label: "Measured and careful",
    description: "State uncertainty clearly and avoid overclaiming.",
    instructions:
      "Be measured and careful. State uncertainty clearly, explain trade-offs, and avoid stronger claims than the available evidence supports.",
  },
  {
    key: "warm",
    label: "Warm and supportive",
    description: "Sound human and encouraging without getting chatty.",
    instructions:
      "Be warm and supportive. Explain clearly, sound human, and stay encouraging without becoming chatty or overly casual.",
  },
  {
    key: "wry",
    label: "Dry and observant",
    description: "Allow subtle wit, but never distract from the work.",
    instructions:
      "Be dry and observant. Allow subtle wit when it fits, but keep it restrained, professional, and never distracting from the task.",
  },
  {
    key: "steady",
    label: "Steady and practical",
    description: "Stay calm, organized, and focused on next steps.",
    instructions:
      "Be steady and practical. Stay calm, organized, and focused on the next useful step, especially when the task is messy or uncertain.",
  },
] as const;
export const DEFAULT_PERSONA_TONE_INSTRUCTIONS = PERSONA_TONE_PRESETS[0].instructions;
export const PERSONA_PALETTES = ["graphite", "moss", "ember", "ocean", "linen", "slate"] as const;
export const PERSONA_CHARACTERS = [
  "architect",
  "builder",
  "analyst",
  "navigator",
  "operator",
  "researcher",
] as const;

const PERSONA_TONE_PRESET_BY_KEY = new Map<string, (typeof PERSONA_TONE_PRESETS)[number]>(
  PERSONA_TONE_PRESETS.map((preset) => [preset.key, preset] as const),
);
const PERSONA_TONE_PRESET_BY_INSTRUCTIONS = new Map<string, (typeof PERSONA_TONE_PRESETS)[number]>(
  PERSONA_TONE_PRESETS.map((preset) => [preset.instructions, preset] as const),
);

export function matchPersonaTonePreset(
  tone: string | null | undefined,
): (typeof PERSONA_TONE_PRESETS)[number] | null {
  const trimmed = tone?.trim() ?? "";
  if (trimmed.length === 0) {
    return PERSONA_TONE_PRESETS[0];
  }

  return (
    PERSONA_TONE_PRESET_BY_KEY.get(trimmed as (typeof PERSONA_TONES)[number]) ??
    PERSONA_TONE_PRESET_BY_INSTRUCTIONS.get(trimmed) ??
    null
  );
}

export function resolvePersonaToneInstructions(tone: string | null | undefined): string {
  const trimmed = tone?.trim() ?? "";
  if (trimmed.length === 0) {
    return DEFAULT_PERSONA_TONE_INSTRUCTIONS;
  }

  return matchPersonaTonePreset(trimmed)?.instructions ?? trimmed;
}

function nextItem<T>(items: readonly T[], current: T, skip: Set<T>): T {
  const currentIndex = items.indexOf(current);
  const baseIndex = currentIndex >= 0 ? currentIndex : -1;

  for (let offset = 1; offset <= items.length; offset += 1) {
    const candidate = items[(baseIndex + offset) % items.length];
    if (candidate !== undefined && !skip.has(candidate)) return candidate;
  }

  return items[0]!;
}

export function randomizePersona(input: {
  current: AgentPersona;
  usedNames?: Iterable<string>;
}): AgentPersona {
  const blockedNames = new Set(
    Array.from(input.usedNames ?? [], (name) => name.trim()).filter(
      (name) => name.length > 0 && name !== input.current.name,
    ),
  );

  const name = nextItem(CODEX_AGENT_NAMES, input.current.name, blockedNames);
  const tone = nextItem(PERSONA_TONES, input.current.tone, new Set());
  const palette = nextItem(PERSONA_PALETTES, input.current.palette, new Set());
  const character = nextItem(PERSONA_CHARACTERS, input.current.character, new Set());

  return {
    name,
    tone,
    palette,
    character,
  };
}
