import type { PlaybookOutputSpec } from "@tyrum/schemas";
import type { AgentRuntime } from "../agent/runtime.js";

export interface ExecutePlaybookLlmStepInput {
  channel: string;
  thread_id: string;
  prompt: string;
  output?: PlaybookOutputSpec;
}

export interface ExecutePlaybookLlmStepResult {
  success: boolean;
  /** Present when output contract is text or unspecified. */
  output_text?: string;
  /** Present when output contract is json and parsing succeeds. */
  output_json?: unknown;
  used_tools: string[];
  error?: string;
  session_id?: string;
}

type OutputKind = "text" | "json";

function normalizeOutputKind(spec: PlaybookOutputSpec | undefined): OutputKind | undefined {
  if (!spec) return undefined;
  if (spec === "text" || spec === "json") return spec;
  return spec.type;
}

export async function executePlaybookLlmStep(
  runtime: AgentRuntime,
  input: ExecutePlaybookLlmStepInput,
): Promise<ExecutePlaybookLlmStepResult> {
  const kind = normalizeOutputKind(input.output);

  try {
    const res = await runtime.turn({
      channel: input.channel,
      thread_id: input.thread_id,
      message: input.prompt,
    });

    if (kind === "json") {
      try {
        const parsed = JSON.parse(res.reply);
        return {
          success: true,
          output_json: parsed,
          used_tools: res.used_tools,
          session_id: res.session_id,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          used_tools: res.used_tools,
          session_id: res.session_id,
          error: `Output contract violated: expected JSON reply (${message})`,
        };
      }
    }

    return {
      success: true,
      output_text: res.reply,
      used_tools: res.used_tools,
      session_id: res.session_id,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, used_tools: [], error: message };
  }
}

