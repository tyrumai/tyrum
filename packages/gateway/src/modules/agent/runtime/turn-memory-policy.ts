import { generateText } from "ai";
import type { LanguageModel } from "ai";
import type { AgentConfig } from "@tyrum/schemas";
import { z } from "zod";
import type { ResolvedAgentTurnInput } from "./turn-helpers.js";
import { isStatusQuery, parseIntakeModeDecision } from "./turn-helpers.js";
import { looksLikeSecretText, redactSecretLikeText } from "./secrets.js";
import { safeJsonParse } from "../../../utils/json.js";

type AutoWriteConfig = AgentConfig["memory"]["v1"]["auto_write"];

const TurnMemoryClassifierSchema = z.object({
  action: z.enum(["none", "note", "episode", "note_and_episode"]),
  reason_code: z
    .enum([
      "none",
      "explicit_preference",
      "explicit_remember",
      "durable_constraint",
      "durable_fact",
      "task_outcome",
      "tool_outcome",
      "failure_lesson",
      "approval_or_policy",
      "delegation_or_milestone",
    ])
    .default("none"),
  title: z.string().trim().min(1).max(120).optional(),
  body_md: z.string().trim().min(1).max(800).optional(),
  summary_md: z.string().trim().min(1).max(320).optional(),
  tags: z.array(z.string().trim().min(1).max(32)).max(5).default([]),
});

export type TurnMemoryDecision =
  | { action: "none"; reasonCode: string }
  | {
      action: "note";
      reasonCode: string;
      title: string;
      bodyMd: string;
      tags: string[];
    }
  | {
      action: "episode";
      reasonCode: string;
      summaryMd: string;
      tags: string[];
    }
  | {
      action: "note_and_episode";
      reasonCode: string;
      title: string;
      bodyMd: string;
      summaryMd: string;
      tags: string[];
    };

export type TurnMemoryPolicyInput = {
  model: LanguageModel;
  config: AutoWriteConfig;
  resolved: ResolvedAgentTurnInput;
  reply: string;
  usedTools: ReadonlySet<string>;
  turnKind: "normal" | "skip";
  logger?: { warn: (msg: string, fields?: Record<string, unknown>) => void };
};

type CandidateKind = "note" | "episode";

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (value.length <= maxChars) return value;
  if (maxChars <= 3) return value.slice(0, maxChars);
  return `${value.slice(0, maxChars - 3)}...`;
}

function normalizeTags(tags: readonly string[]): string[] {
  const next = new Set<string>();
  for (const raw of tags) {
    const value = raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!value) continue;
    next.add(value);
    if (next.size >= 5) break;
  }
  return Array.from(next);
}

function lowSignalTurn(message: string, reply: string): boolean {
  const msg = message.toLowerCase();
  const res = reply.toLowerCase();
  if (msg.length <= 24 && /^(ok|okay|thanks?|thank you|hi|hello|yes|no)$/u.test(msg)) return true;
  return (
    res.length <= 48 &&
    /^(ok|okay|done|thanks?|thank you|sounds good|hello|hi|no assistant response returned\.)$/u.test(
      res,
    )
  );
}

function noteCandidateKind(message: string): CandidateKind | undefined {
  const normalized = message.toLowerCase();
  if (normalized.includes("i prefer")) return "note";
  if (normalized.includes("remember this") || normalized.includes("remember that")) return "note";
  if (normalized.includes("for future reference")) return "note";
  if (normalized.includes("always ") || normalized.includes("never ")) return "note";
  if (normalized.includes("by default")) return "note";
  if (normalized.includes("we use ") || normalized.includes("our repo")) return "note";
  return undefined;
}

function episodeCandidateKind(
  message: string,
  reply: string,
  usedTools: ReadonlySet<string>,
): CandidateKind | undefined {
  if (usedTools.size > 0) return "episode";
  const combined = `${message}\n${reply}`.toLowerCase();
  if (
    /(?:fixed|resolved|failed|failure|completed|blocked|approved|denied|root cause|rolled back|updated|opened pr|merged|deployed)/u.test(
      combined,
    )
  ) {
    return "episode";
  }
  return undefined;
}

function deterministicNote(message: string): TurnMemoryDecision {
  const normalized = message.toLowerCase();
  const title = normalized.includes("i prefer")
    ? "User preference"
    : normalized.includes("always ") || normalized.includes("never ")
      ? "Durable constraint"
      : "Remembered fact";
  return {
    action: "note",
    reasonCode: normalized.includes("i prefer") ? "explicit_preference" : "explicit_remember",
    title,
    bodyMd: truncate(message, 600),
    tags: normalizeTags(["agent-turn", "durable-memory"]),
  };
}

function deterministicEpisode(
  reply: string,
  channel: string,
  usedTools: ReadonlySet<string>,
): TurnMemoryDecision {
  const prefix = usedTools.size > 0 ? "Tool outcome" : "Turn outcome";
  return {
    action: "episode",
    reasonCode: usedTools.size > 0 ? "tool_outcome" : "task_outcome",
    summaryMd: truncate(`${prefix}: ${reply} (${channel})`, 280),
    tags: normalizeTags([
      "agent-turn",
      "episode",
      usedTools.size > 0 ? "tool-outcome" : "task-outcome",
    ]),
  };
}

function extractJsonObject(text: string): string | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1];
  const candidate = fenced ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  return candidate.slice(start, end + 1);
}

function toDecision(
  parsed: z.infer<typeof TurnMemoryClassifierSchema>,
): TurnMemoryDecision | undefined {
  const tags = normalizeTags(parsed.tags);
  if (parsed.action === "none") return { action: "none", reasonCode: parsed.reason_code };
  if (parsed.action === "note" && parsed.title && parsed.body_md) {
    return {
      action: "note",
      reasonCode: parsed.reason_code,
      title: parsed.title,
      bodyMd: parsed.body_md,
      tags,
    };
  }
  if (parsed.action === "episode" && parsed.summary_md) {
    return {
      action: "episode",
      reasonCode: parsed.reason_code,
      summaryMd: parsed.summary_md,
      tags,
    };
  }
  if (parsed.action === "note_and_episode" && parsed.title && parsed.body_md && parsed.summary_md) {
    return {
      action: "note_and_episode",
      reasonCode: parsed.reason_code,
      title: parsed.title,
      bodyMd: parsed.body_md,
      summaryMd: parsed.summary_md,
      tags,
    };
  }
  return undefined;
}

export async function classifyTurnMemory(
  input: TurnMemoryPolicyInput,
): Promise<TurnMemoryDecision> {
  if (!input.config.enabled) return { action: "none", reasonCode: "none" };
  if (input.turnKind !== "normal") return { action: "none", reasonCode: "none" };
  if (isStatusQuery(input.resolved.message) || parseIntakeModeDecision(input.resolved.message)) {
    return { action: "none", reasonCode: "none" };
  }

  const message = normalize(redactSecretLikeText(input.resolved.message));
  const reply = normalize(redactSecretLikeText(input.reply));
  if (!message && !reply) return { action: "none", reasonCode: "none" };

  const noteCandidate = noteCandidateKind(message);
  const episodeCandidate = noteCandidate
    ? undefined
    : episodeCandidateKind(message, reply, input.usedTools);
  if (!noteCandidate && !episodeCandidate && lowSignalTurn(message, reply)) {
    return { action: "none", reasonCode: "none" };
  }
  if (!noteCandidate && !episodeCandidate) {
    return { action: "none", reasonCode: "none" };
  }
  if (looksLikeSecretText(`${input.resolved.message}\n${input.reply}`) && noteCandidate) {
    return { action: "none", reasonCode: "none" };
  }

  const fallback =
    noteCandidate === "note"
      ? deterministicNote(message)
      : input.config.classifier === "rule_based"
        ? deterministicEpisode(reply, input.resolved.channel, input.usedTools)
        : ({ action: "none", reasonCode: "none" } as const);
  if (input.config.classifier === "rule_based") return fallback;

  try {
    const result = await generateText({
      model: input.model,
      system:
        "Classify whether this conversational turn should be stored in long-term memory. " +
        "Memory is sparse and not a transcript store. Return JSON only.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                `Candidate kind: ${noteCandidate ?? episodeCandidate}\n` +
                `Channel: ${input.resolved.channel}\n` +
                `Thread: ${input.resolved.thread_id}\n` +
                `Used tools: ${Array.from(input.usedTools).join(", ") || "(none)"}\n` +
                `User: ${truncate(message, 500)}\n` +
                `Assistant: ${truncate(reply, 500)}\n\n` +
                "Return one JSON object with fields action, reason_code, title, body_md, summary_md, tags. " +
                "Prefer action=none unless the turn contains durable preferences/facts/constraints or a meaningful reusable outcome.",
            },
          ],
        },
      ],
    });
    const rawJson = extractJsonObject(result.text);
    const parsed = TurnMemoryClassifierSchema.safeParse(safeJsonParse(rawJson, null));
    if (parsed.success) {
      const decision = toDecision(parsed.data);
      if (decision) return decision;
    }
  } catch (error) {
    input.logger?.warn("memory.turn_classifier_failed", {
      channel: input.resolved.channel,
      thread_id: input.resolved.thread_id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return fallback;
}
