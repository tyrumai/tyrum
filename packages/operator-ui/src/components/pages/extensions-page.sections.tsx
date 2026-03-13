import type { ManagedExtensionDetail, ManagedExtensionSummary } from "@tyrum/schemas";
import { History, RefreshCw, Upload } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { Input } from "../ui/input.js";

export function ImportGuard({
  canMutate,
  requestEnter,
  children,
}: {
  canMutate: boolean;
  requestEnter: () => void;
  children: ReactNode;
}) {
  if (canMutate) return <>{children}</>;
  return (
    <Alert
      variant="warning"
      title="Admin access required"
      description={
        <div className="flex flex-wrap items-center gap-3">
          <span>Imports and changes require temporary admin access.</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              requestEnter();
            }}
          >
            Authorize admin access
          </Button>
        </div>
      }
    />
  );
}

export function ExtensionCard({
  item,
  detail,
  inspectLoading,
  mutateLoading,
  onInspect,
  onToggle,
  onRefresh,
  onRevert,
}: {
  item: ManagedExtensionSummary;
  detail: ManagedExtensionDetail | undefined;
  inspectLoading: boolean;
  mutateLoading: boolean;
  onInspect: () => void;
  onToggle: () => void;
  onRefresh: () => void;
  onRevert: (revision: number) => void;
}) {
  const revisions = detail?.revisions ?? [];

  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-semibold text-fg">{item.name}</div>
              <Badge variant="outline">{item.key}</Badge>
              {item.version ? <Badge variant="outline">{item.version}</Badge> : null}
              <Badge variant={item.enabled ? "success" : "outline"}>
                {item.enabled ? "enabled" : "disabled"}
              </Badge>
              {item.transport ? <Badge variant="outline">{item.transport}</Badge> : null}
            </div>
            {item.description ? (
              <div className="text-sm text-fg-muted">{item.description}</div>
            ) : null}
            <div className="flex flex-wrap gap-2 text-xs text-fg-muted">
              <span>{`revision ${String(item.revision)}`}</span>
              <span>{`${String(item.assignment_count)} agent assignments`}</span>
              <span>{item.refreshable ? "refreshable" : "manual re-upload"}</span>
            </div>
            {item.materialized_path ? (
              <div className="text-xs text-fg-muted">{item.materialized_path}</div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" isLoading={inspectLoading} onClick={onInspect}>
              <History className="h-4 w-4" />
              Inspect
            </Button>
            <Button variant="outline" size="sm" isLoading={mutateLoading} onClick={onToggle}>
              {item.enabled ? "Disable" : "Enable"}
            </Button>
            {item.refreshable ? (
              <Button variant="outline" size="sm" isLoading={mutateLoading} onClick={onRefresh}>
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
            ) : null}
          </div>
        </div>

        {detail ? (
          <div className="grid gap-3 rounded-lg border border-border/80 bg-bg-subtle/50 p-3">
            <div className="text-sm font-medium text-fg">Revision history</div>
            {revisions.length > 0 ? (
              <div className="grid gap-2">
                {revisions.map((revision) => (
                  <div
                    key={revision.revision}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/70 bg-bg px-3 py-2"
                  >
                    <div className="grid gap-1 text-sm">
                      <div className="font-medium text-fg">{`Revision ${String(revision.revision)}`}</div>
                      <div className="text-xs text-fg-muted">
                        {revision.created_at}
                        {revision.reason ? ` • ${revision.reason}` : ""}
                      </div>
                    </div>
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
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-fg-muted">No revisions available.</div>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function SkillImportPanel({
  disabled,
  isLoading,
  onImportUrl,
  onUpload,
}: {
  disabled: boolean;
  isLoading: boolean;
  onImportUrl: (url: string) => void;
  onUpload: (file: File) => void;
}) {
  const [url, setUrl] = useState("");

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="text-base font-semibold text-fg">Import Skill</div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Input
          label="Archive or SKILL.md URL"
          value={url}
          onChange={(event) => setUrl(event.currentTarget.value)}
          placeholder="https://example.com/skill.zip"
          helperText="Use ClawHub-style download links or direct SKILL.md URLs."
        />
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={disabled || url.trim().length === 0}
            isLoading={isLoading}
            onClick={() => {
              onImportUrl(url.trim());
              setUrl("");
            }}
          >
            Import URL
          </Button>
          <label className="inline-flex">
            <input
              type="file"
              accept=".zip,.md,.markdown,text/markdown,application/zip"
              className="hidden"
              disabled={disabled || isLoading}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (!file) return;
                onUpload(file);
                event.currentTarget.value = "";
              }}
            />
            <Button asChild variant="outline" disabled={disabled || isLoading}>
              <span>
                <Upload className="h-4 w-4" />
                Upload
              </span>
            </Button>
          </label>
        </div>
      </CardContent>
    </Card>
  );
}

export function McpImportPanel({
  disabled,
  isLoading,
  onImportRemote,
  onImportNpm,
  onUpload,
}: {
  disabled: boolean;
  isLoading: boolean;
  onImportRemote: (url: string) => void;
  onImportNpm: (npmSpec: string) => void;
  onUpload: (file: File) => void;
}) {
  const [url, setUrl] = useState("");
  const [npmSpec, setNpmSpec] = useState("");

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="text-base font-semibold text-fg">Import MCP Server</div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Input
          label="Remote endpoint URL"
          value={url}
          onChange={(event) => setUrl(event.currentTarget.value)}
          placeholder="https://mcp.example.com"
        />
        <Button
          disabled={disabled || url.trim().length === 0}
          isLoading={isLoading}
          onClick={() => {
            onImportRemote(url.trim());
            setUrl("");
          }}
        >
          Import Remote URL
        </Button>
        <Input
          label="npm spec"
          value={npmSpec}
          onChange={(event) => setNpmSpec(event.currentTarget.value)}
          placeholder="@modelcontextprotocol/server-filesystem"
          helperText="Stored as an `npx -y <spec>` stdio MCP server."
        />
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={disabled || npmSpec.trim().length === 0}
            isLoading={isLoading}
            onClick={() => {
              onImportNpm(npmSpec.trim());
              setNpmSpec("");
            }}
          >
            Import npm
          </Button>
          <label className="inline-flex">
            <input
              type="file"
              accept=".zip,.yml,.yaml,application/zip,text/yaml,application/yaml"
              className="hidden"
              disabled={disabled || isLoading}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (!file) return;
                onUpload(file);
                event.currentTarget.value = "";
              }}
            />
            <Button asChild variant="outline" disabled={disabled || isLoading}>
              <span>
                <Upload className="h-4 w-4" />
                Upload
              </span>
            </Button>
          </label>
        </div>
      </CardContent>
    </Card>
  );
}
