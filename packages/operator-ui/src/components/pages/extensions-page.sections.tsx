import type { ManagedExtensionDetail, ManagedExtensionSummary } from "@tyrum/schemas";
import { History, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import {
  applyMemorySettingsToForm,
  buildMemoryServerSettings,
  createBlankForm,
  type AgentEditorFormState,
} from "./agents-page-editor-form.js";
import { MemorySettingsFields } from "./memory-settings-fields.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";
import { Select } from "../ui/select.js";
import { Textarea } from "../ui/textarea.js";

type DefaultsUpdateInput = {
  default_access: "inherit" | "allow" | "deny";
  settings_format?: "json" | "yaml";
  settings_text?: string;
};

function formatSourceTypeLabel(sourceType: ManagedExtensionSummary["source_type"]): string {
  switch (sourceType) {
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

function describeSource(source: ManagedExtensionSummary["source"]): string | null {
  if (!source) return null;
  switch (source.kind) {
    case "direct-url":
      return source.url;
    case "npm":
      return source.npm_spec;
    case "upload":
      return source.filename ?? "uploaded artifact";
  }
}

export function ExtensionCard({
  item,
  detail,
  inspectLoading,
  mutateLoading,
  canMutate,
  requestEnter,
  onInspect,
  onToggle,
  onRefresh,
  onRevert,
  onUpdateDefaults,
}: {
  item: ManagedExtensionSummary;
  detail: ManagedExtensionDetail | undefined;
  inspectLoading: boolean;
  mutateLoading: boolean;
  canMutate: boolean;
  requestEnter: () => void;
  onInspect: () => void;
  onToggle: () => void;
  onRefresh: () => void;
  onRevert: (revision: number) => void;
  onUpdateDefaults: (input: DefaultsUpdateInput) => void;
}) {
  const revisions = detail?.revisions ?? [];
  const [defaultAccess, setDefaultAccess] = useState(item.default_access);
  const [settingsFormat, setSettingsFormat] = useState<"json" | "yaml">(
    detail?.default_mcp_server_settings_yaml ? "yaml" : "json",
  );
  const [settingsText, setSettingsText] = useState(
    detail?.default_mcp_server_settings_yaml ??
      (detail?.default_mcp_server_settings_json
        ? JSON.stringify(detail.default_mcp_server_settings_json, null, 2)
        : ""),
  );
  const [memoryForm, setMemoryForm] = useState<AgentEditorFormState>(() =>
    applyMemorySettingsToForm(
      createBlankForm(),
      detail?.default_mcp_server_settings_json ?? undefined,
    ),
  );

  useEffect(() => {
    setDefaultAccess(detail?.default_access ?? item.default_access);
  }, [detail?.default_access, item.default_access]);

  useEffect(() => {
    setSettingsFormat(detail?.default_mcp_server_settings_yaml ? "yaml" : "json");
    setSettingsText(
      detail?.default_mcp_server_settings_yaml ??
        (detail?.default_mcp_server_settings_json
          ? JSON.stringify(detail.default_mcp_server_settings_json, null, 2)
          : ""),
    );
  }, [detail?.default_mcp_server_settings_json, detail?.default_mcp_server_settings_yaml]);

  useEffect(() => {
    setMemoryForm(
      applyMemorySettingsToForm(
        createBlankForm(),
        detail?.default_mcp_server_settings_json ?? undefined,
      ),
    );
  }, [detail?.default_mcp_server_settings_json]);

  const revisionLabel =
    item.revision === null ? "no source revision" : `revision ${String(item.revision)}`;
  const sourceLabel = formatSourceTypeLabel(item.source_type);
  const sourceDescription = describeSource(item.source);

  const saveDefaultAccess = () => {
    if (!canMutate) {
      requestEnter();
      return;
    }
    onUpdateDefaults({ default_access: defaultAccess });
  };

  const saveSettings = () => {
    if (!canMutate) {
      requestEnter();
      return;
    }
    if (item.key === "memory") {
      onUpdateDefaults({
        default_access: defaultAccess,
        settings_format: "json",
        settings_text: JSON.stringify(buildMemoryServerSettings(memoryForm), null, 2),
      });
      return;
    }
    onUpdateDefaults({
      default_access: defaultAccess,
      settings_format: settingsFormat,
      settings_text: settingsText,
    });
  };

  const setMemoryField = <K extends keyof AgentEditorFormState>(
    key: K,
    value: AgentEditorFormState[K],
  ) => {
    setMemoryForm((current) => ({
      ...current,
      [key]: value,
    }));
  };

  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-semibold text-fg">{item.name}</div>
              <Badge variant="outline">{item.key}</Badge>
              {item.version ? <Badge variant="outline">{item.version}</Badge> : null}
              <Badge variant="outline">{sourceLabel}</Badge>
              <Badge variant={item.enabled ? "success" : "outline"}>
                {item.enabled ? "enabled" : "disabled"}
              </Badge>
              <Badge variant="outline">{`default ${item.default_access}`}</Badge>
              {item.transport ? <Badge variant="outline">{item.transport}</Badge> : null}
            </div>
            {item.description ? (
              <div className="text-sm text-fg-muted">{item.description}</div>
            ) : null}
            <div className="flex flex-wrap gap-2 text-xs text-fg-muted">
              <span>{revisionLabel}</span>
              <span>{`${String(item.assignment_count)} agent assignments`}</span>
              <span>{item.can_refresh_source ? "refreshable" : "no source refresh"}</span>
            </div>
            {item.materialized_path ? (
              <div className="text-xs text-fg-muted">{item.materialized_path}</div>
            ) : null}
            {sourceDescription ? (
              <div className="text-xs text-fg-muted">{sourceDescription}</div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" isLoading={inspectLoading} onClick={onInspect}>
              <History className="h-4 w-4" />
              Inspect
            </Button>
            {item.can_toggle_source_enabled ? (
              <Button variant="outline" size="sm" isLoading={mutateLoading} onClick={onToggle}>
                {item.enabled ? "Disable" : "Enable"}
              </Button>
            ) : null}
            {item.can_refresh_source ? (
              <Button variant="outline" size="sm" isLoading={mutateLoading} onClick={onRefresh}>
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
            ) : null}
          </div>
        </div>

        {detail ? (
          <div className="grid gap-3 rounded-lg border border-border/80 bg-bg-subtle/50 p-3">
            <div className="grid gap-3 rounded-md border border-border/70 bg-bg px-3 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm font-medium text-fg">Shared default access</div>
                <Button
                  variant="outline"
                  size="sm"
                  isLoading={mutateLoading}
                  onClick={saveDefaultAccess}
                >
                  Save access
                </Button>
              </div>
              <Select
                label="Default access"
                value={defaultAccess}
                disabled={mutateLoading}
                onChange={(event) => {
                  setDefaultAccess(
                    event.currentTarget.value as DefaultsUpdateInput["default_access"],
                  );
                }}
                helperText="Agents inherit this unless they explicitly allow or deny the extension."
              >
                <option value="inherit">Inherit agent default</option>
                <option value="allow">Enabled by default</option>
                <option value="deny">Disabled by default</option>
              </Select>
            </div>

            <div className="grid gap-2 rounded-md border border-border/70 bg-bg px-3 py-3">
              <div className="text-sm font-medium text-fg">Discovered sources</div>
              <div className="grid gap-2">
                {detail.sources.map((source) => (
                  <div
                    key={`${source.source_type}:${source.materialized_path ?? source.revision ?? source.transport ?? "source"}`}
                    className="flex flex-wrap items-center gap-2 text-sm text-fg"
                  >
                    <Badge variant={source.is_effective ? "success" : "outline"}>
                      {source.is_effective
                        ? "effective"
                        : formatSourceTypeLabel(source.source_type)}
                    </Badge>
                    {!source.is_effective ? (
                      <Badge variant="outline">{formatSourceTypeLabel(source.source_type)}</Badge>
                    ) : null}
                    <span>{source.enabled ? "enabled" : "disabled"}</span>
                    {source.transport ? <span>{source.transport}</span> : null}
                    {source.revision ? <span>{`revision ${String(source.revision)}`}</span> : null}
                    {describeSource(source.source) ? (
                      <span className="text-fg-muted">{describeSource(source.source)}</span>
                    ) : null}
                    {source.materialized_path ? (
                      <span className="text-fg-muted">{source.materialized_path}</span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            {item.can_edit_settings ? (
              <div className="grid gap-3 rounded-md border border-border/70 bg-bg px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm font-medium text-fg">Shared MCP server settings</div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      isLoading={mutateLoading}
                      onClick={saveSettings}
                    >
                      Save settings
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={mutateLoading}
                      onClick={() => {
                        if (!canMutate) {
                          requestEnter();
                          return;
                        }
                        onUpdateDefaults({
                          default_access: defaultAccess,
                          settings_format: item.key === "memory" ? "json" : settingsFormat,
                          settings_text: "",
                        });
                      }}
                    >
                      Clear settings
                    </Button>
                  </div>
                </div>
                {item.key === "memory" ? (
                  <MemorySettingsFields form={memoryForm} setField={setMemoryField} />
                ) : (
                  <>
                    <Select
                      label="Settings format"
                      value={settingsFormat}
                      disabled={mutateLoading}
                      onChange={(event) => {
                        setSettingsFormat(event.currentTarget.value as "json" | "yaml");
                      }}
                    >
                      <option value="yaml">YAML</option>
                      <option value="json">JSON</option>
                    </Select>
                    <Textarea
                      label="Default server settings"
                      rows={12}
                      value={settingsText}
                      spellCheck={false}
                      autoCapitalize="none"
                      autoCorrect="off"
                      helperText="Leave blank and save to remove shared default settings. The server parses JSON or YAML on save."
                      onChange={(event) => {
                        setSettingsText(event.currentTarget.value);
                      }}
                    />
                  </>
                )}
              </div>
            ) : null}

            <div className="grid gap-3 rounded-md border border-border/70 bg-bg px-3 py-3">
              <div className="text-sm font-medium text-fg">Revision history</div>
              {revisions.length > 0 ? (
                <div className="grid gap-2">
                  {revisions.map((revision) => (
                    <div
                      key={revision.revision}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/70 bg-bg-subtle/50 px-3 py-2"
                    >
                      <div className="grid gap-1 text-sm">
                        <div className="font-medium text-fg">{`Revision ${String(revision.revision)}`}</div>
                        <div className="text-xs text-fg-muted">
                          {revision.created_at}
                          {revision.reason ? ` • ${revision.reason}` : ""}
                        </div>
                      </div>
                      {item.can_revert_source ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={revision.revision === item.revision || mutateLoading}
                          onClick={() => {
                            onRevert(revision.revision);
                          }}
                        >
                          Revert
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-fg-muted">No source revisions available.</div>
              )}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
