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
export const PERSONA_PALETTES = ["graphite", "moss", "ember", "ocean", "linen", "slate"] as const;
export const PERSONA_CHARACTERS = [
  "architect",
  "builder",
  "analyst",
  "navigator",
  "operator",
  "researcher",
] as const;

function nextItem<T>(items: readonly T[], current: T, skip: Set<T>): T {
  const currentIndex = items.indexOf(current);
  const baseIndex = currentIndex >= 0 ? currentIndex : -1;

  for (let offset = 1; offset <= items.length; offset += 1) {
    const candidate = items[(baseIndex + offset) % items.length];
    if (candidate !== undefined && !skip.has(candidate)) return candidate;
  }

  return items[0]!;
}

export function buildPersonaDescription(character: string, tone: string): string {
  return `Autonomous ${character} with a ${tone} tone.`;
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
    description: buildPersonaDescription(character, tone),
  };
}
