import { z } from "zod";
import { NodePairingTrustLevel } from "./node.js";
import { NodeId } from "./keys.js";
import { DevicePlatform } from "./protocol/connect.js";

const TOOL_ID_SEGMENT = "[a-z][a-z0-9-]*";
const DEDICATED_TOOL_ID_PATTERN = new RegExp(
  `^tool\\.${TOOL_ID_SEGMENT}(?:\\.${TOOL_ID_SEGMENT})+$`,
);

function rejectGenericNodeHelperToolIds(value: string): boolean {
  return !value.startsWith("tool.node.");
}

export const ExplicitDedicatedToolId = z
  .string()
  .trim()
  .min(1)
  .regex(DEDICATED_TOOL_ID_PATTERN, "tool ids must be explicit, namespaced dedicated tool ids")
  .refine(rejectGenericNodeHelperToolIds, {
    message: "generic node helper tool ids are not dedicated routed tools",
  });
export type ExplicitDedicatedToolId = z.infer<typeof ExplicitDedicatedToolId>;

export const RoutedToolTargeting = z
  .object({
    node_id: NodeId.optional(),
    timeout_ms: z.number().int().positive().max(600_000).optional(),
  })
  .strict();
export type RoutedToolTargeting = z.infer<typeof RoutedToolTargeting>;

export const RoutedToolSelectionMode = z.enum(["explicit", "attached_node", "sole_eligible_node"]);
export type RoutedToolSelectionMode = z.infer<typeof RoutedToolSelectionMode>;

export const RoutedToolSelectedNode = z
  .object({
    label: z.string().trim().min(1).optional(),
    platform: DevicePlatform.optional(),
    trust_level: NodePairingTrustLevel.optional(),
  })
  .strict();
export type RoutedToolSelectedNode = z.infer<typeof RoutedToolSelectedNode>;

export const RoutedToolExecutionMetadata = z
  .object({
    requested_node_id: NodeId.optional(),
    selected_node_id: NodeId,
    selection_mode: RoutedToolSelectionMode,
    selected_node: RoutedToolSelectedNode.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.selection_mode === "explicit") {
      if (!value.requested_node_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["requested_node_id"],
          message: "explicit selection requires requested_node_id",
        });
        return;
      }
      if (value.requested_node_id !== value.selected_node_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["selected_node_id"],
          message: "explicit selection must keep requested_node_id and selected_node_id aligned",
        });
      }
      return;
    }

    if (value.requested_node_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requested_node_id"],
        message: "implicit selection metadata must not include requested_node_id",
      });
    }
  });
export type RoutedToolExecutionMetadata = z.infer<typeof RoutedToolExecutionMetadata>;

export const SecretReferenceId = z.string().trim().min(1).max(256);
export type SecretReferenceId = z.infer<typeof SecretReferenceId>;

export const SecretReferenceAlias = z.string().trim().min(1).max(120);
export type SecretReferenceAlias = z.infer<typeof SecretReferenceAlias>;

export const SecretReferenceSelector = z
  .object({
    secret_ref_id: SecretReferenceId.optional(),
    secret_alias: SecretReferenceAlias.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const selectorCount =
      Number(Boolean(value.secret_ref_id)) + Number(Boolean(value.secret_alias));
    if (selectorCount === 1) {
      return;
    }
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["secret_ref_id"],
      message: "exactly one of secret_ref_id or secret_alias is required",
    });
  });
export type SecretReferenceSelector = z.infer<typeof SecretReferenceSelector>;

export const SecretCopyToNodeClipboardArgs = SecretReferenceSelector.extend({
  node_id: NodeId.optional(),
}).strict();
export type SecretCopyToNodeClipboardArgs = z.infer<typeof SecretCopyToNodeClipboardArgs>;
