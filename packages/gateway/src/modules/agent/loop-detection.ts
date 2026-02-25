import { sha256HexFromString, stableJsonStringify } from "../policy/canonical-json.js";

export const LOOP_WARNING_PREFIX = "Loop warning:";

type ToolCallLike = {
  toolName?: unknown;
  input?: unknown;
};

type StepLike = {
  toolCalls?: unknown;
};

function coerceToolCalls(value: unknown): ToolCallLike[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => entry && typeof entry === "object") as ToolCallLike[];
}

function safeToolCallSignature(toolCall: ToolCallLike): string | undefined {
  const toolName = typeof toolCall.toolName === "string" ? toolCall.toolName.trim() : "";
  if (toolName.length === 0) return undefined;

  let canonicalArgs = "";
  try {
    canonicalArgs = stableJsonStringify(toolCall.input);
  } catch {
    canonicalArgs = "";
  }
  const argsHash = sha256HexFromString(canonicalArgs);
  return `${toolName}:${argsHash}`;
}

export function signatureForToolStep(step: unknown): { signature: string; toolNames: string[] } | undefined {
  if (!step || typeof step !== "object") return undefined;
  const toolCalls = coerceToolCalls((step as StepLike).toolCalls);
  if (toolCalls.length === 0) return undefined;

  const toolNames = toolCalls
    .map((tc) => (typeof tc.toolName === "string" ? tc.toolName.trim() : ""))
    .filter((name) => name.length > 0);

  const callSigs = toolCalls
    .map(safeToolCallSignature)
    .filter((sig): sig is string => typeof sig === "string" && sig.length > 0)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  if (callSigs.length === 0) return undefined;
  return { signature: callSigs.join("|"), toolNames };
}

export type WithinTurnToolLoopDetection =
  | { kind: "consecutive"; toolNames: string[] }
  | { kind: "cycle"; toolNames: string[] };

export function detectWithinTurnToolLoop(input: {
  steps: readonly unknown[];
  consecutiveRepeatLimit: number;
  cycleRepeatLimit: number;
}): WithinTurnToolLoopDetection | undefined {
  const consecutiveLimit = Math.max(2, Math.floor(input.consecutiveRepeatLimit));
  const cycleLimit = Math.max(2, Math.floor(input.cycleRepeatLimit));

  const signatures: string[] = [];
  const toolNamesBySignature: Map<string, string[]> = new Map();

  for (const step of input.steps) {
    const sig = signatureForToolStep(step);
    if (!sig) continue;
    signatures.push(sig.signature);
    if (!toolNamesBySignature.has(sig.signature)) {
      toolNamesBySignature.set(sig.signature, sig.toolNames);
    }
  }

  if (signatures.length >= consecutiveLimit) {
    const tail = signatures.slice(-consecutiveLimit);
    const first = tail[0];
    if (first && tail.every((sig) => sig === first)) {
      return {
        kind: "consecutive",
        toolNames: toolNamesBySignature.get(first) ?? [],
      };
    }
  }

  const minCycleLen = cycleLimit * 2;
  if (signatures.length >= minCycleLen) {
    const tail = signatures.slice(-minCycleLen);
    const a = tail[0];
    const b = tail[1];
    if (a && b && a !== b) {
      let matches = true;
      for (let i = 0; i < tail.length; i += 1) {
        const expected = i % 2 === 0 ? a : b;
        if (tail[i] !== expected) {
          matches = false;
          break;
        }
      }
      if (matches) {
        const toolNames: string[] = [];
        const seen = new Set<string>();
        for (const name of [...(toolNamesBySignature.get(a) ?? []), ...(toolNamesBySignature.get(b) ?? [])]) {
          if (seen.has(name)) continue;
          seen.add(name);
          toolNames.push(name);
        }
        return {
          kind: "cycle",
          toolNames,
        };
      }
    }
  }

  return undefined;
}

export function stripLoopWarning(text: string): string {
  if (!text.includes(LOOP_WARNING_PREFIX)) return text;
  return text
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith(LOOP_WARNING_PREFIX))
    .join("\n");
}

function tokenizeForSimilarity(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 3);
}

export function jaccardSimilarity(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  const [small, big] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
  let intersection = 0;
  for (const token of small) {
    if (big.has(token)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  if (union <= 0) return 0;
  return intersection / union;
}

export type CrossTurnLoopDecision =
  | { warn: false }
  | { warn: true; similarity: number; matchedIndex: number };

export function decideCrossTurnLoopWarning(input: {
  previousAssistantMessages: readonly string[];
  reply: string;
  windowAssistantMessages: number;
  similarityThreshold: number;
  minChars: number;
  cooldownAssistantMessages: number;
}): CrossTurnLoopDecision {
  const minChars = Math.max(0, Math.floor(input.minChars));
  const windowSize = Math.max(0, Math.floor(input.windowAssistantMessages));
  const cooldownSize = Math.max(0, Math.floor(input.cooldownAssistantMessages));
  const threshold = Math.max(0, Math.min(1, input.similarityThreshold));

  if (windowSize <= 0) return { warn: false };

  const recent = input.previousAssistantMessages.slice(-windowSize);
  const cooldownWindow = cooldownSize > 0
    ? input.previousAssistantMessages.slice(-cooldownSize)
    : [];

  if (cooldownWindow.some((msg) => msg.includes(LOOP_WARNING_PREFIX))) {
    return { warn: false };
  }

  const normalizedReply = stripLoopWarning(input.reply).trim();
  if (normalizedReply.length < minChars) return { warn: false };

  const replyTokens = tokenizeForSimilarity(normalizedReply);

  for (let i = 0; i < recent.length; i += 1) {
    const candidate = stripLoopWarning(recent[i] ?? "").trim();
    if (candidate.length < minChars) continue;

    if (candidate === normalizedReply) {
      return { warn: true, similarity: 1, matchedIndex: i };
    }

    const similarity = jaccardSimilarity(replyTokens, tokenizeForSimilarity(candidate));
    if (similarity >= threshold) {
      return { warn: true, similarity, matchedIndex: i };
    }
  }

  return { warn: false };
}
