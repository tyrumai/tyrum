import type { AgentCapabilitiesResponse, ManagedExtensionDetail } from "@tyrum/contracts";
import { Select } from "../ui/select.js";
import { StructuredJsonField } from "../ui/structured-json-field.js";

export type AgentMcpSettingsDraft = {
  error: string | null;
  mode: "inherit" | "override";
  value: Record<string, unknown> | undefined;
};

export function effectiveSourceLabel(detail: ManagedExtensionDetail | undefined): string {
  if (!detail) return "unknown";
  switch (detail.source_type) {
    case "builtin":
      return "built-in";
    case "bundled":
      return "bundled";
    case "user":
      return "user";
    case "local":
      return "local";
    case "managed":
      return "managed";
    case "shared":
      return "shared";
  }
}

function defaultSettingsValue(
  detail: ManagedExtensionDetail | undefined,
): Record<string, unknown> | undefined {
  return detail?.default_mcp_server_settings_json ?? undefined;
}

export function AgentEditorMcpOverrides({
  items,
  detailsById,
  explicitServerSettings,
  loading,
  error,
  drafts,
  onDraftChange,
}: {
  items: AgentCapabilitiesResponse["mcp"]["items"];
  detailsById: Record<string, ManagedExtensionDetail>;
  explicitServerSettings: Record<string, Record<string, unknown>>;
  loading: boolean;
  error: string | null;
  drafts: Record<string, AgentMcpSettingsDraft>;
  onDraftChange: (serverId: string, draft: AgentMcpSettingsDraft) => void;
}) {
  return (
    <div className="grid gap-3 rounded-lg border border-border/70 p-3">
      <div className="text-sm font-medium text-fg">MCP server settings overrides</div>
      <div className="text-sm text-fg-muted">
        {error
          ? error
          : loading
            ? "Loading shared MCP defaults..."
            : "Override inherited server settings per MCP server, or reset back to the shared default."}
      </div>
      {items.length === 0 && !loading ? (
        <div className="text-sm text-fg-muted">No additional MCP servers discovered.</div>
      ) : null}
      {items.map((item) => {
        const detail = detailsById[item.id];
        const explicitSettings = explicitServerSettings[item.id];
        const draft =
          drafts[item.id] ??
          (explicitSettings
            ? {
                error: null,
                mode: "override" as const,
                value: explicitSettings,
              }
            : {
                error: null,
                mode: "inherit" as const,
                value: defaultSettingsValue(detail),
              });

        return (
          <div
            key={item.id}
            className="grid gap-3 rounded-md border border-border/70 bg-bg px-3 py-3"
          >
            <div className="grid gap-1">
              <div className="text-sm font-medium text-fg">{item.name}</div>
              <div className="text-xs text-fg-muted">
                {`${item.id} • effective source: ${effectiveSourceLabel(detail)}`}
              </div>
              <div className="text-xs text-fg-muted">
                {detail?.default_mcp_server_settings_json
                  ? "Shared default settings are available."
                  : "No shared default settings are configured."}
              </div>
            </div>
            <Select
              label={`Settings mode for ${item.name}`}
              value={draft.mode}
              disabled={loading}
              onChange={(event) => {
                const nextMode = event.currentTarget.value as AgentMcpSettingsDraft["mode"];
                onDraftChange(item.id, {
                  error: null,
                  mode: nextMode,
                  value:
                    nextMode === "override"
                      ? (draft.value ?? defaultSettingsValue(detail) ?? {})
                      : undefined,
                });
              }}
            >
              <option value="inherit">Inherit shared default</option>
              <option value="override">Override for this agent</option>
            </Select>
            {draft.mode === "override" ? (
              <StructuredJsonField
                data-testid={`structured-json-override-${item.id}`}
                label={`Server settings for ${item.name}`}
                allowedRootKinds={["object"]}
                value={draft.value}
                helperText="These settings are saved into this agent's MCP override config."
                onJsonChange={(nextValue, nextErrorMessage) => {
                  onDraftChange(item.id, {
                    ...draft,
                    error: nextErrorMessage,
                    value: nextValue as Record<string, unknown> | undefined,
                  });
                }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
