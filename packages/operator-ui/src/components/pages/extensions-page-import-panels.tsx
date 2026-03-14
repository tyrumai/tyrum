import { Upload } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Alert } from "../ui/alert.js";
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
          <Button variant="outline" size="sm" onClick={requestEnter}>
            Authorize admin access
          </Button>
        </div>
      }
    />
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
