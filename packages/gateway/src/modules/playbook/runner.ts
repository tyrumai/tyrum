/**
 * Playbook runner.
 *
 * Converts PlaybookStep[] into ActionPrimitive[] for the execution engine,
 * and tracks per-playbook execution metadata.
 */

import type { ActionPrimitive, Playbook, PlaybookStep } from "@tyrum/schemas";
import { PlaybookCompileError } from "./errors.js";

export interface PlaybookRunResult {
  playbook_id: string;
  steps: ActionPrimitive[];
  created_at: string;
}

export interface PlaybookStats {
  playbook_id: string;
  run_count: number;
}

function splitNamespace(command: string): { ns: string; rest: string } {
  const trimmed = command.trim();
  const idx = trimmed.indexOf(" ");
  if (idx === -1) {
    return { ns: trimmed.toLowerCase(), rest: "" };
  }
  return { ns: trimmed.slice(0, idx).toLowerCase(), rest: trimmed.slice(idx + 1).trim() };
}

function tokenizeArgs(input: string): string[] {
  const tokens: string[] = [];
  let buf = "";
  let inQuotes = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;
    if (ch === "\"") {
      inQuotes = !inQuotes;
      buf += ch;
      continue;
    }
    if (!inQuotes && /\s/.test(ch)) {
      if (buf.length > 0) {
        tokens.push(buf);
        buf = "";
      }
      continue;
    }
    buf += ch;
  }
  if (buf.length > 0) {
    tokens.push(buf);
  }
  return tokens;
}

function unquote(token: string): string {
  if (token.startsWith("\"") && token.endsWith("\"") && token.length >= 2) {
    return token.slice(1, -1);
  }
  return token;
}

function parseKeyValueArgs(raw: string): Record<string, string> {
  const tokens = tokenizeArgs(raw);
  const args: Record<string, string> = {};
  for (const token of tokens) {
    const eqIdx = token.indexOf("=");
    if (eqIdx === -1) continue;
    const key = token.slice(0, eqIdx).trim();
    if (!key) continue;
    let value = token.slice(eqIdx + 1).trim();
    if (value.startsWith("\"") && value.endsWith("\"") && value.length >= 2) {
      value = value.slice(1, -1);
    }
    args[key] = value;
  }
  return args;
}

function parseMcpToolId(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "";
  if (trimmed.startsWith("mcp.")) return trimmed;
  return `mcp.${trimmed}`;
}

/** Convert a PlaybookStep to an ActionPrimitive. */
function withPlaybookMeta(
  args: Record<string, unknown>,
  playbookId: string,
  step: PlaybookStep,
): Record<string, unknown> {
  return {
    ...args,
    __playbook: {
      playbook_id: playbookId,
      step_id: step.id,
      step_name: step.name ?? null,
      stdin: step.stdin ?? null,
      condition: step.condition ?? null,
      approval: step.approval ?? null,
      output: step.output ?? null,
    },
  };
}

/** Convert a PlaybookStep to an ActionPrimitive. */
function stepToPrimitive(
  playbookId: string,
  step: PlaybookStep,
  _index: number,
): ActionPrimitive {
  const { ns, rest } = splitNamespace(step.command);
  const idempotency_key = `playbook:${playbookId}:${step.id}`;

  if (ns === "http") {
    const parts = tokenizeArgs(rest).map(unquote).filter(Boolean);
    const maybeMethod = parts[0]?.toUpperCase();
    const isMethod = maybeMethod !== undefined && ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(maybeMethod);
    const method = isMethod ? maybeMethod : "GET";
    const url = isMethod ? parts[1] : parts[0];
    if (!url) throw new PlaybookCompileError("http command requires a URL");
    return {
      type: "Http",
      args: withPlaybookMeta(
        {
          method: method ?? "GET",
          url,
        },
        playbookId,
        step,
      ),
      postcondition: step.postcondition,
      idempotency_key,
    };
  }

  if (ns === "cli") {
    const parts = tokenizeArgs(rest).map(unquote).filter(Boolean);
    const cmd = parts[0];
    const cmdArgs = parts.slice(1);
    if (!cmd) {
      throw new PlaybookCompileError("cli command requires at least one token");
    }
    return {
      type: "CLI",
      args: withPlaybookMeta({ cmd, args: cmdArgs }, playbookId, step),
      postcondition: step.postcondition,
      idempotency_key,
    };
  }

  if (ns === "web") {
    const parts = tokenizeArgs(rest).map(unquote).filter(Boolean);
    const op = parts[0];
    if (!op) {
      throw new PlaybookCompileError(
        "web command requires an operation (e.g. navigate/click/fill/snapshot)",
      );
    }

    if (op === "navigate") {
      const url = parts[1];
      if (!url) {
        throw new PlaybookCompileError("web navigate requires a URL");
      }
      return {
        type: "Web",
        args: withPlaybookMeta({ op: "navigate", url }, playbookId, step),
        postcondition: step.postcondition,
        idempotency_key,
      };
    }

    if (op === "click") {
      const selector = parts[1];
      if (!selector) {
        throw new PlaybookCompileError("web click requires a selector");
      }
      return {
        type: "Web",
        args: withPlaybookMeta({ op: "click", selector }, playbookId, step),
        postcondition: step.postcondition,
        idempotency_key,
      };
    }

    if (op === "fill") {
      const selector = parts[1];
      const value = parts[2];
      if (!selector || value === undefined) {
        throw new PlaybookCompileError("web fill requires selector and value");
      }
      return {
        type: "Web",
        args: withPlaybookMeta({ op: "fill", selector, value }, playbookId, step),
        postcondition: step.postcondition,
        idempotency_key,
      };
    }

    if (op === "snapshot") {
      return {
        type: "Web",
        args: withPlaybookMeta({ op: "snapshot" }, playbookId, step),
        postcondition: step.postcondition,
        idempotency_key,
      };
    }

    return {
      type: "Web",
      args: withPlaybookMeta({ op }, playbookId, step),
      postcondition: step.postcondition,
      idempotency_key,
    };
  }

  if (ns === "mcp") {
    const parts = tokenizeArgs(rest).filter(Boolean);
    const toolToken = unquote(parts[0] ?? "").trim();
    const tool_id = parseMcpToolId(toolToken);
    if (!tool_id) {
      throw new PlaybookCompileError("mcp command requires a tool id like 'github.search'");
    }
    const idParts = tool_id.split(".").filter((p) => p.trim().length > 0);
    if (idParts.length < 3 || idParts[0] !== "mcp") {
      throw new PlaybookCompileError(`invalid mcp tool id: '${tool_id}'`);
    }
    const args = parseKeyValueArgs(parts.slice(1).join(" "));
    return {
      type: "Mcp",
      args: withPlaybookMeta({ tool_id, args }, playbookId, step),
      postcondition: step.postcondition,
      idempotency_key,
    };
  }

  if (ns === "node") {
    const parts = tokenizeArgs(rest).filter(Boolean);
    const capability = unquote(parts[0] ?? "").trim();
    const action = unquote(parts[1] ?? "").trim();
    if (!capability || !action) {
      throw new PlaybookCompileError("node command requires: node <capability> <action> [key=value ...]");
    }
    const args = parseKeyValueArgs(parts.slice(2).join(" "));
    return {
      type: "Node",
      args: withPlaybookMeta({ capability, action, args }, playbookId, step),
      postcondition: step.postcondition,
      idempotency_key,
    };
  }

  throw new PlaybookCompileError(`Unsupported playbook command namespace: '${ns}'`);
}

export class PlaybookRunner {
  private readonly stats = new Map<string, number>();

  /** Convert a playbook's steps to action primitives for execution. */
  run(playbook: Playbook): PlaybookRunResult {
    const steps = playbook.manifest.steps.map((step, index) =>
      stepToPrimitive(playbook.manifest.id, step, index),
    );

    const prev = this.stats.get(playbook.manifest.id) ?? 0;
    this.stats.set(playbook.manifest.id, prev + 1);

    return {
      playbook_id: playbook.manifest.id,
      steps,
      created_at: new Date().toISOString(),
    };
  }

  /** Get execution stats for all playbooks that have been run. */
  getStats(): PlaybookStats[] {
    const result: PlaybookStats[] = [];
    for (const [playbook_id, run_count] of this.stats) {
      result.push({ playbook_id, run_count });
    }
    return result;
  }
}
