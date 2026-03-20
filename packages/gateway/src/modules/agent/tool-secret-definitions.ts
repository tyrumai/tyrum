import {
  SecretCopyToNodeClipboardArgs,
  type AgentSecretReference,
  type SecretReferenceSelector,
} from "@tyrum/contracts";
import type { ToolDescriptor } from "./tools.js";

export const SECRET_CLIPBOARD_TOOL_ID = "tool.secret.copy-to-node-clipboard";
export const SECRET_CLIPBOARD_CAPABILITY_ID = "tyrum.desktop.clipboard-write";
export const SECRET_CLIPBOARD_ACTION_NAME = "clipboard_write";

type AllowedSecretReference = {
  secret_ref_id: AgentSecretReference["secret_ref_id"];
  secret_alias?: AgentSecretReference["secret_alias"];
  display_name?: AgentSecretReference["display_name"];
};

function jsonSchemaOf(schema: {
  toJSONSchema?: (opts?: { io?: "input" | "output" }) => unknown;
}): Record<string, unknown> {
  const json = schema.toJSONSchema?.({ io: "input" });
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return { type: "object", additionalProperties: false };
  }
  return json as Record<string, unknown>;
}

function listAllowedSecretReferences(
  secretRefs: readonly AgentSecretReference[],
  toolId: string,
): AllowedSecretReference[] {
  return secretRefs
    .filter((secretRef) => secretRef.allowed_tool_ids.includes(toolId))
    .map((secretRef) => {
      const allowedSecretReference: AllowedSecretReference = {
        secret_ref_id: secretRef.secret_ref_id,
      };
      if (secretRef.secret_alias) {
        allowedSecretReference.secret_alias = secretRef.secret_alias;
      }
      if (secretRef.display_name) {
        allowedSecretReference.display_name = secretRef.display_name;
      }
      return allowedSecretReference;
    });
}

function describeAllowedSecretReference(secretRef: AllowedSecretReference): string {
  const label = secretRef.display_name ?? secretRef.secret_alias ?? secretRef.secret_ref_id;
  const details = [
    `secret_ref_id=${secretRef.secret_ref_id}`,
    secretRef.secret_alias ? `secret_alias=${secretRef.secret_alias}` : "",
  ]
    .filter((value) => value.length > 0)
    .join(", ");
  return `${label} (${details})`;
}

export function buildSecretClipboardToolDescriptor(
  secretRefs: readonly AgentSecretReference[],
): ToolDescriptor | undefined {
  const allowedSecretRefs = listAllowedSecretReferences(secretRefs, SECRET_CLIPBOARD_TOOL_ID);
  if (allowedSecretRefs.length === 0) {
    return undefined;
  }

  const firstRef = allowedSecretRefs[0]!;
  const firstSelector = firstRef.secret_alias
    ? { secret_alias: firstRef.secret_alias }
    : { secret_ref_id: firstRef.secret_ref_id };
  const secretReferenceSummary = allowedSecretRefs
    .slice(0, 20)
    .map(describeAllowedSecretReference)
    .join("; ");
  const remainingSecretRefCount = Math.max(0, allowedSecretRefs.length - 20);

  return {
    id: SECRET_CLIPBOARD_TOOL_ID,
    description:
      "Copy an allowlisted secret reference to the clipboard of an eligible desktop node without returning the plaintext secret.",
    effect: "state_changing",
    keywords: ["secret", "clipboard", "copy", "desktop", "node", "password", "token"],
    promptGuidance: [
      "Use exactly one selector: secret_alias when available, otherwise secret_ref_id.",
      "Omit node_id only when exactly one eligible clipboard-capable node exists. If multiple exist, use tool.node.list first and provide node_id explicitly.",
      `Available secret references: ${secretReferenceSummary}${remainingSecretRefCount > 0 ? `; plus ${String(remainingSecretRefCount)} more` : ""}`,
    ],
    promptExamples: [
      JSON.stringify(firstSelector),
      JSON.stringify({ ...firstSelector, node_id: "node_123" }),
    ],
    source: "builtin",
    family: "node",
    inputSchema: jsonSchemaOf(SecretCopyToNodeClipboardArgs),
  };
}

export function resolveAllowedSecretReference(
  secretRefs: readonly AgentSecretReference[],
  toolId: string,
  selector: SecretReferenceSelector,
): AllowedSecretReference | undefined {
  const allowedSecretRefs = listAllowedSecretReferences(secretRefs, toolId);
  if ("secret_ref_id" in selector && selector.secret_ref_id) {
    return allowedSecretRefs.find(
      (secretRef) => secretRef.secret_ref_id === selector.secret_ref_id,
    );
  }
  if ("secret_alias" in selector && selector.secret_alias) {
    return allowedSecretRefs.find((secretRef) => secretRef.secret_alias === selector.secret_alias);
  }
  return undefined;
}
