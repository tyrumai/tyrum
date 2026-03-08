import type {
  AgentConfig as AgentConfigT,
  AgentPersona as AgentPersonaT,
  IdentityPack as IdentityPackT,
} from "@tyrum/schemas";
import { AgentConfig, AgentPersona } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import { safeJsonParse } from "../../utils/json.js";

const CODEX_AGENT_NAMES = [
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

const PERSONA_TONES = ["direct", "curious", "measured", "warm", "wry", "steady"] as const;
const PERSONA_PALETTES = ["graphite", "moss", "ember", "ocean", "linen", "slate"] as const;
const PERSONA_CHARACTERS = [
  "architect",
  "builder",
  "analyst",
  "navigator",
  "operator",
  "researcher",
] as const;

type LatestConfigRow = {
  agent_id: string;
  config_json: string;
};

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pickFrom<T>(items: readonly T[], seed: string): T {
  return items[hashString(seed) % items.length] ?? items[0]!;
}

function humanizeAgentKey(agentKey: string): string {
  return agentKey
    .trim()
    .split(/[-_]+/u)
    .filter((part) => part.length > 0)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function parseStoredConfig(configJson: string): AgentConfigT | undefined {
  const parsed = safeJsonParse(configJson, null) as unknown;
  const config = AgentConfig.safeParse(parsed);
  return config.success ? config.data : undefined;
}

function defaultDescription(character: string, tone: string): string {
  return `Autonomous ${character} with a ${tone} tone.`;
}

export async function listLatestAgentConfigsByAgentId(
  db: SqlDb,
  tenantId: string,
): Promise<Map<string, AgentConfigT>> {
  const rows = await db.all<LatestConfigRow>(
    `SELECT current.agent_id, current.config_json
     FROM agent_configs AS current
     INNER JOIN (
       SELECT agent_id, MAX(revision) AS revision
       FROM agent_configs
       WHERE tenant_id = ?
       GROUP BY agent_id
     ) AS latest
       ON latest.agent_id = current.agent_id
      AND latest.revision = current.revision
     WHERE current.tenant_id = ?`,
    [tenantId, tenantId],
  );

  return new Map(
    rows
      .map((row) => {
        const config = parseStoredConfig(row.config_json);
        return config ? ([row.agent_id, config] as const) : undefined;
      })
      .filter((entry): entry is readonly [string, AgentConfigT] => entry !== undefined),
  );
}

export function pickSeededPersonaName(params: {
  tenantId: string;
  agentKey: string;
  usedNames: Iterable<string>;
  candidates?: readonly string[];
}): string {
  const candidates = params.candidates ?? CODEX_AGENT_NAMES;
  const used = new Set(Array.from(params.usedNames, (name) => name.trim()).filter(Boolean));
  const baseIndex = hashString(`${params.tenantId}:${params.agentKey}:name`) % candidates.length;

  for (let offset = 0; offset < candidates.length; offset += 1) {
    const candidate = candidates[(baseIndex + offset) % candidates.length];
    if (!candidate) continue;
    if (!used.has(candidate)) return candidate;
  }

  const baseName = candidates[baseIndex] ?? candidates[0] ?? "Agent";
  const suffix = hashString(`${params.tenantId}:${params.agentKey}:suffix`)
    .toString(36)
    .slice(0, 4)
    .padStart(4, "0");
  return `${baseName}-${suffix}`;
}

function buildSeededPersonaRecord(params: {
  tenantId: string;
  agentKey: string;
  name: string;
}): AgentPersonaT {
  const tone = pickFrom(PERSONA_TONES, `${params.tenantId}:${params.agentKey}:tone`);
  const palette = pickFrom(PERSONA_PALETTES, `${params.tenantId}:${params.agentKey}:palette`);
  const character = pickFrom(PERSONA_CHARACTERS, `${params.tenantId}:${params.agentKey}:character`);

  return AgentPersona.parse({
    name: params.name,
    description: defaultDescription(character, tone),
    tone,
    palette,
    character,
  });
}

export async function buildSeededAgentPersona(params: {
  db: SqlDb;
  tenantId: string;
  agentId: string;
  agentKey: string;
}): Promise<AgentPersonaT> {
  const configsByAgentId = await listLatestAgentConfigsByAgentId(params.db, params.tenantId);
  const usedNames = new Set<string>();

  for (const [agentId, config] of configsByAgentId) {
    if (agentId === params.agentId) continue;
    const name = config.persona?.name?.trim();
    if (name) usedNames.add(name);
  }

  const name = pickSeededPersonaName({
    tenantId: params.tenantId,
    agentKey: params.agentKey,
    usedNames,
  });

  return buildSeededPersonaRecord({
    tenantId: params.tenantId,
    agentKey: params.agentKey,
    name,
  });
}

export function resolveAgentPersona(params: {
  agentKey: string;
  config?: AgentConfigT | null;
  identity?: IdentityPackT | null;
}): AgentPersonaT {
  if (params.config?.persona) {
    return AgentPersona.parse(params.config.persona);
  }

  const tone = params.identity?.meta.style?.tone?.trim() || "direct";
  const name = params.identity?.meta.name?.trim() || humanizeAgentKey(params.agentKey) || "Agent";
  const description =
    params.identity?.meta.description?.trim() || defaultDescription("architect", tone);

  return AgentPersona.parse({
    name,
    description,
    tone,
    palette: "graphite",
    character: "architect",
  });
}

export function applyPersonaToIdentity(
  identity: IdentityPackT,
  persona: AgentPersonaT,
): IdentityPackT {
  return {
    ...identity,
    meta: {
      ...identity.meta,
      name: persona.name,
      description: persona.description,
      style: {
        ...identity.meta.style,
        tone: persona.tone,
      },
    },
  };
}
