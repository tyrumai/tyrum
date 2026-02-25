import { z } from "zod";

/**
 * Playbook steps are authored as `command` strings and compiled into typed
 * runtime actions by the gateway.
 */

export const PlaybookOutputKind = z.enum(["text", "json"]);
export type PlaybookOutputKind = z.infer<typeof PlaybookOutputKind>;

const PlaybookOutputJsonSchema = z.union([z.boolean(), z.record(z.string(), z.unknown())]);

export const PlaybookOutputSpec = z.union([
  PlaybookOutputKind,
  z
    .object({
      type: PlaybookOutputKind,
      schema: PlaybookOutputJsonSchema.optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
      if (value.schema !== undefined && value.type !== "json") {
        ctx.addIssue({
          code: "custom",
          message: "output schema is only allowed when output.type is 'json'",
          path: ["schema"],
        });
      }
    }),
]);
export type PlaybookOutputSpec = z.infer<typeof PlaybookOutputSpec>;

export const PlaybookApprovalSpec = z.enum(["required"]);
export type PlaybookApprovalSpec = z.infer<typeof PlaybookApprovalSpec>;

const PLAYBOOK_COMMAND_NAMESPACES = ["cli", "http", "web", "mcp", "node", "llm"] as const;
const PLAYBOOK_COMMAND_NAMESPACE_SET = new Set<string>(PLAYBOOK_COMMAND_NAMESPACES);

function playbookCommandNamespace(command: string): string {
  const trimmed = command.trim();
  if (trimmed.length === 0) return "";
  const spaceIdx = trimmed.indexOf(" ");
  const ns = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).trim().toLowerCase();
  return ns;
}

/** A single step within a playbook. */
export const PlaybookStep = z
  .object({
    /** Stable step identifier used for referencing prior outputs. */
    id: z.string().trim().min(1),
    /** Optional human-readable label. */
    name: z.string().trim().min(1).optional(),
    /**
     * Namespaced command string compiled by the runtime.
     * Example: `cli git status`, `http GET https://example.com`.
     */
    command: z
      .string()
      .trim()
      .min(1)
      .superRefine((value, ctx) => {
        const ns = playbookCommandNamespace(value);
        if (!PLAYBOOK_COMMAND_NAMESPACE_SET.has(ns)) {
          ctx.addIssue({
            code: "custom",
            message:
              `unsupported playbook command namespace '${ns || "<missing>"}'; ` +
              `expected one of: ${PLAYBOOK_COMMAND_NAMESPACES.join(", ")}`,
          });
        }
      }),
    /** Optional stdin reference, e.g. `$stepId.stdout` or `$stepId.json`. */
    stdin: z.string().trim().min(1).optional(),
    /** Optional condition expression for skipping this step. */
    condition: z.string().trim().min(1).optional(),
    /** Optional approval gate. */
    approval: PlaybookApprovalSpec.optional(),
    /** Declared output contract for parsing and caps. */
    output: PlaybookOutputSpec.optional(),
    /** Optional LLM step configuration (required when command namespace is `llm`). */
    llm: z
      .object({
        /** Model identifier in `provider/model` form. */
        model: z.string().trim().min(1),
        /** Prompt text supplied to the model. */
        prompt: z.string().trim().min(1),
        /** Maximum number of tool calls allowed during this step. */
        max_tool_calls: z.number().int().nonnegative().optional(),
        /** Tool allowlist for this step (tool ids). */
        tools: z
          .object({
            allow: z.array(z.string().trim().min(1)).default([]),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    /** Optional postcondition spec evaluated against step evidence. */
    postcondition: z.unknown().optional(),
    /** Operator-facing rollback guidance for reversible steps. */
    rollback_hint: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ns = playbookCommandNamespace(value.command);
    const isLlm = ns === "llm";

    if (isLlm && !value.llm) {
      ctx.addIssue({
        code: "custom",
        message: "llm config is required when command namespace is 'llm'",
        path: ["llm"],
      });
    }

    if (!isLlm && value.llm) {
      ctx.addIssue({
        code: "custom",
        message: "llm config is only allowed when command namespace is 'llm'",
        path: ["llm"],
      });
    }

    if (isLlm) {
      const output = value.output;
      const kind = typeof output === "string" ? output : output?.type;
      if (kind !== "json") {
        ctx.addIssue({
          code: "custom",
          message: "llm steps must declare output as JSON (output: json or output.type: json)",
          path: ["output"],
        });
      }
    }
  });
export type PlaybookStep = z.infer<typeof PlaybookStep>;

/** Top-level playbook manifest parsed from YAML. */
export const PlaybookManifest = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    description: z.string().trim().min(1).optional(),
    version: z.string().trim().min(1),
    args: z.record(z.string(), z.unknown()).optional(),
    steps: z.array(PlaybookStep).min(1),
    allowed_domains: z.array(z.string().trim().min(1)).optional(),
    consent_boundary: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const step of value.steps) {
      const id = step.id;
      if (seen.has(id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate step id '${id}'`,
          path: ["steps"],
        });
      }
      seen.add(id);
    }
  });
export type PlaybookManifest = z.infer<typeof PlaybookManifest>;

/** A loaded playbook with filesystem metadata. */
export const Playbook = z.object({
  manifest: PlaybookManifest,
  file_path: z.string(),
  loaded_at: z.string(),
});
export type Playbook = z.infer<typeof Playbook>;
