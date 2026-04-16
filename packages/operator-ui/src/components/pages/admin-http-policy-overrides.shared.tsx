import type { ToolRegistryListResult } from "@tyrum/operator-app/browser";
import * as React from "react";
import { Badge, type BadgeVariant } from "../ui/badge.js";

export type PolicyOverrideRecord = {
  policy_override_id: string;
  status: "active" | "revoked" | "expired";
  created_at: string;
  created_by?: unknown;
  agent_id: string;
  workspace_id?: string;
  tool_id: string;
  pattern: string;
  expires_at?: string | null;
  revoked_at?: string | null;
  revoked_reason?: string;
};

export type PolicyAgentOption = {
  agentId: string;
  agentKey: string;
  displayName: string;
};

type RawPolicyToolOption = ToolRegistryListResult["tools"][number];
type RawPolicyToolAlias = RawPolicyToolOption["aliases"][number];

export type PolicyToolOption = Pick<RawPolicyToolOption, "canonical_id" | "description"> & {
  aliases: readonly PolicyToolAlias[];
  lifecycle: RawPolicyToolOption["lifecycle"] | null;
  visibility: RawPolicyToolOption["visibility"] | null;
};

type PolicyToolAlias = RawPolicyToolAlias;

export type ResolvedPolicyTool = {
  entry: PolicyToolOption;
  matchedAlias: PolicyToolAlias | null;
};

export function statusVariant(
  status: PolicyOverrideRecord["status"],
): "success" | "warning" | "danger" {
  if (status === "active") return "success";
  if (status === "expired") return "warning";
  return "danger";
}

export function expiryVariant(override: PolicyOverrideRecord): "default" | "warning" {
  if (!override.expires_at) return "default";
  const expiresAt = Date.parse(override.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt > Date.now()) return "default";
  return "warning";
}

export function agentLabel(agent: PolicyAgentOption | undefined): string {
  if (!agent) return "Unknown agent";
  return agent.displayName === agent.agentKey
    ? agent.agentKey
    : `${agent.displayName} (${agent.agentKey})`;
}

export function resolvedToolId(selectedToolId: string, customToolId: string): string {
  return (selectedToolId === "__custom__" ? customToolId : selectedToolId).trim();
}

export function isDateTimeLocalValue(raw: string): boolean {
  if (!raw.trim()) return true;
  return Number.isFinite(Date.parse(raw));
}

export function wildcardHelper(toolId: string): string {
  if (toolId === "connector.send") {
    return "Use exact destinations when possible, for example `telegram:work:123`.";
  }
  if (
    toolId.startsWith("tool.desktop.") ||
    toolId.startsWith("tool.browser.") ||
    toolId === "tool.location.get" ||
    toolId.startsWith("tool.camera.") ||
    toolId === "tool.audio.record"
  ) {
    return "Prefer exact dedicated tool targets instead of broad wildcard families.";
  }
  return "Use `*` for many characters and `?` for one. Avoid broad leading wildcards when possible.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizePolicyToolAlias(value: unknown): PolicyToolAlias | null {
  if (!isRecord(value) || typeof value.id !== "string") {
    return null;
  }
  const id = value.id.trim();
  if (!id) {
    return null;
  }
  if (value.lifecycle !== "alias" && value.lifecycle !== "deprecated") {
    return null;
  }
  return {
    id,
    lifecycle: value.lifecycle,
  };
}

function normalizePolicyToolLifecycle(value: unknown): PolicyToolOption["lifecycle"] {
  if (value === "canonical" || value === "alias" || value === "deprecated") {
    return value;
  }
  return null;
}

function normalizePolicyToolVisibility(value: unknown): PolicyToolOption["visibility"] {
  if (value === "public" || value === "internal" || value === "runtime_only") {
    return value;
  }
  return null;
}

export function normalizePolicyToolOptions(tools: unknown): PolicyToolOption[] {
  if (!Array.isArray(tools)) {
    return [];
  }

  return tools
    .flatMap((tool): PolicyToolOption[] => {
      if (!isRecord(tool) || typeof tool.canonical_id !== "string") {
        return [];
      }
      const canonicalId = tool.canonical_id.trim();
      if (!canonicalId) {
        return [];
      }

      return [
        {
          canonical_id: canonicalId,
          description: typeof tool.description === "string" ? tool.description : "",
          aliases: Array.isArray(tool.aliases)
            ? tool.aliases.flatMap((alias) => {
                const normalizedAlias = normalizePolicyToolAlias(alias);
                return normalizedAlias ? [normalizedAlias] : [];
              })
            : [],
          lifecycle: normalizePolicyToolLifecycle(tool.lifecycle),
          visibility: normalizePolicyToolVisibility(tool.visibility),
        },
      ];
    })
    .toSorted((left, right) => left.canonical_id.localeCompare(right.canonical_id));
}

export function buildPolicyToolLookup(
  tools: readonly PolicyToolOption[],
): Map<string, ResolvedPolicyTool> {
  const lookup = new Map<string, ResolvedPolicyTool>();
  for (const tool of tools) {
    const canonicalId = tool.canonical_id.trim();
    if (!canonicalId) continue;
    lookup.set(canonicalId, { entry: tool, matchedAlias: null });
  }
  for (const tool of tools) {
    for (const alias of tool.aliases) {
      const aliasId = alias.id.trim();
      if (!aliasId || lookup.has(aliasId)) continue;
      lookup.set(aliasId, { entry: tool, matchedAlias: alias });
    }
  }
  return lookup;
}

export function resolvePolicyTool(
  toolLookup: ReadonlyMap<string, ResolvedPolicyTool>,
  toolId: string,
): ResolvedPolicyTool | null {
  const normalizedToolId = toolId.trim();
  if (!normalizedToolId) {
    return null;
  }
  return toolLookup.get(normalizedToolId) ?? null;
}

export function resolvedCanonicalToolId(
  toolLookup: ReadonlyMap<string, ResolvedPolicyTool>,
  toolId: string,
): string {
  const normalizedToolId = toolId.trim();
  if (!normalizedToolId) {
    return "";
  }
  return resolvePolicyTool(toolLookup, normalizedToolId)?.entry.canonical_id ?? normalizedToolId;
}

function aliasSummary(aliases: readonly PolicyToolAlias[]): string {
  return aliases.map((alias) => `${alias.id} (${alias.lifecycle})`).join(", ");
}

function lifecycleBadgeVariant(lifecycle: PolicyToolAlias["lifecycle"] | "deprecated"): BadgeVariant {
  return lifecycle === "deprecated" ? "warning" : "outline";
}

function matchedAliasBadgeLabel(alias: PolicyToolAlias): string {
  return alias.lifecycle === "deprecated" ? "deprecated alias match" : "alias match";
}

export function PolicyToolMetadataPanel({
  title,
  toolId,
  resolved,
  rawToolIdLabel = "Saved tool ID",
  unavailableMessage = "Registry metadata unavailable for this tool ID.",
  testId,
}: {
  title: string;
  toolId: string;
  resolved: ResolvedPolicyTool | null;
  rawToolIdLabel?: string;
  unavailableMessage?: string;
  testId?: string;
}): React.ReactElement | null {
  const normalizedToolId = toolId.trim();
  if (!normalizedToolId && !resolved) {
    return null;
  }

  const canonicalId = resolved?.entry.canonical_id ?? normalizedToolId;
  const showRawToolId = normalizedToolId.length > 0 && normalizedToolId !== canonicalId;
  const visibility = resolved?.entry.visibility;
  const lifecycle = resolved?.entry.lifecycle;

  return (
    <div
      className="grid gap-2 rounded-lg border border-border/80 bg-bg-subtle/40 p-3 text-sm"
      data-testid={testId}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">{title}</div>
      <div className="flex flex-wrap gap-2">
        <Badge variant="default">
          <span className="font-mono text-xs">{canonicalId || "Unknown"}</span>
        </Badge>
        {visibility ? <Badge variant="outline">{visibility}</Badge> : null}
        {lifecycle && lifecycle !== "canonical" ? (
          <Badge variant={lifecycleBadgeVariant(lifecycle)}>
            {lifecycle}
          </Badge>
        ) : null}
        {resolved?.matchedAlias ? (
          <Badge variant={lifecycleBadgeVariant(resolved.matchedAlias.lifecycle)}>
            {matchedAliasBadgeLabel(resolved.matchedAlias)}
          </Badge>
        ) : null}
      </div>
      {showRawToolId ? (
        <div className="text-fg-muted">
          <span className="font-medium text-fg">{rawToolIdLabel}:</span>{" "}
          <span className="font-mono text-fg">{normalizedToolId}</span>
        </div>
      ) : null}
      {resolved?.entry.description ? (
        <div className="text-fg-muted">{resolved.entry.description}</div>
      ) : null}
      {resolved?.entry.aliases.length ? (
        <div className="text-fg-muted">
          <span className="font-medium text-fg">Aliases:</span>{" "}
          {aliasSummary(resolved.entry.aliases)}
        </div>
      ) : null}
      {!resolved && normalizedToolId ? (
        <div className="text-fg-muted">{unavailableMessage}</div>
      ) : null}
    </div>
  );
}
