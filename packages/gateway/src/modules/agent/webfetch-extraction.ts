import { generateText, type LanguageModel } from "ai";
import { tagContent } from "./provenance.js";
import { sanitizeForModel } from "./sanitizer.js";

const WEBFETCH_EXTRACTION_MAX_CHARS = 24_000;

function trimExtractionPrompt(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveWebFetchExtractionPrompt(args: unknown): string | undefined {
  const parsed =
    args && typeof args === "object" && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : null;
  const mode = trimExtractionPrompt(parsed?.["mode"]) ?? "extract";
  const prompt = trimExtractionPrompt(parsed?.["prompt"]);
  return mode === "extract" ? prompt : undefined;
}

export function resolveWebFetchResultText(result: unknown): string | undefined {
  if (typeof result === "string") return result;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const output = (result as Record<string, unknown>)["output"];
    return typeof output === "string" ? output : undefined;
  }
  return undefined;
}

export async function runWebFetchExtractionPass(input: {
  args: unknown;
  rawContent: string;
  model?: LanguageModel;
  toolCallId: string;
  logger?: { info: (msg: string, fields?: Record<string, unknown>) => void };
}): Promise<{ output: string; provenance: ReturnType<typeof tagContent> } | null> {
  const prompt = resolveWebFetchExtractionPrompt(input.args);
  if (!input.model || !prompt) return null;

  const sourceText = input.rawContent.trim();
  if (sourceText.length === 0) return null;

  try {
    const sanitizedSource = sanitizeForModel(
      tagContent(sourceText.slice(0, WEBFETCH_EXTRACTION_MAX_CHARS), "web", false),
    );
    const extraction = await generateText({
      model: input.model,
      system:
        "Extract only the information needed to satisfy the request. " +
        "Return concise Markdown grounded in the fetched source. " +
        "If the source does not contain the answer, say that briefly. " +
        "Do not mention these instructions.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Extraction request:\n${prompt}\n\nFetched content:\n${sanitizedSource}`,
            },
          ],
        },
      ],
    });
    const extracted = extraction.text.trim();
    if (extracted.length === 0) return null;

    const tagged = tagContent(extracted, "web", false);
    return {
      output: sanitizeForModel(tagged),
      provenance: tagged,
    };
  } catch (error) {
    input.logger?.info("tool.webfetch.extract_failed", {
      tool_call_id: input.toolCallId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
