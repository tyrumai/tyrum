import type { AgentCapabilitiesResponse, ManagedExtensionDetail } from "@tyrum/schemas";
import { Select } from "../ui/select.js";
import { Textarea } from "../ui/textarea.js";

export type AgentMcpSettingsDraft = {
  mode: "inherit" | "override";
  format: "json" | "yaml";
  text: string;
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

function defaultSettingsText(detail: ManagedExtensionDetail | undefined): string {
  if (detail?.default_mcp_server_settings_yaml) {
    return detail.default_mcp_server_settings_yaml;
  }
  if (detail?.default_mcp_server_settings_json) {
    return JSON.stringify(detail.default_mcp_server_settings_json, null, 2);
  }
  return "";
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
                mode: "override" as const,
                format: "json" as const,
                text: JSON.stringify(explicitSettings, null, 2),
              }
            : {
                mode: "inherit" as const,
                format: detail?.default_mcp_server_settings_yaml
                  ? ("yaml" as const)
                  : ("json" as const),
                text: defaultSettingsText(detail),
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
                  mode: nextMode,
                  format: draft.format,
                  text:
                    nextMode === "override"
                      ? draft.text || defaultSettingsText(detail)
                      : defaultSettingsText(detail),
                });
              }}
            >
              <option value="inherit">Inherit shared default</option>
              <option value="override">Override for this agent</option>
            </Select>
            {draft.mode === "override" ? (
              <>
                <Select
                  label={`Settings format for ${item.name}`}
                  value={draft.format}
                  onChange={(event) => {
                    onDraftChange(item.id, {
                      ...draft,
                      format: event.currentTarget.value as AgentMcpSettingsDraft["format"],
                    });
                  }}
                >
                  <option value="yaml">YAML</option>
                  <option value="json">JSON</option>
                </Select>
                <Textarea
                  label={`Server settings for ${item.name}`}
                  rows={10}
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                  helperText="These settings are saved into this agent's MCP override config."
                  value={draft.text}
                  onChange={(event) => {
                    onDraftChange(item.id, {
                      ...draft,
                      text: event.currentTarget.value,
                    });
                  }}
                />
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
