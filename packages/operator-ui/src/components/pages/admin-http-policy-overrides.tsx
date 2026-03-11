import * as React from "react";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { ElevatedModeTooltip } from "../elevated-mode/elevated-mode-tooltip.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardFooter, CardHeader } from "../ui/card.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import { Input } from "../ui/input.js";
import { Select } from "../ui/select.js";
import { Textarea } from "../ui/textarea.js";
import { formatTimestamp } from "./admin-http-policy-config-primitives.js";

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

export type PolicyToolOption = {
  toolId: string;
  description: string;
  risk: "low" | "medium" | "high";
};

export interface PolicyOverridesSectionProps {
  overrides: PolicyOverrideRecord[];
  loadBusy: boolean;
  loadError: unknown;
  createBusy: boolean;
  createError: unknown;
  revokeBusy: boolean;
  revokeError: unknown;
  canMutate: boolean;
  requestEnter: () => void;
  agents: PolicyAgentOption[];
  tools: PolicyToolOption[];
  onRefresh: () => void;
  onCreate: (input: {
    agent_id: string;
    workspace_id?: string;
    tool_id: string;
    pattern: string;
    expires_at?: string;
  }) => Promise<boolean>;
  onRevoke: (input: { policy_override_id: string; reason: string }) => Promise<void>;
}

function statusVariant(status: PolicyOverrideRecord["status"]): "success" | "warning" | "danger" {
  if (status === "active") return "success";
  if (status === "expired") return "warning";
  return "danger";
}

function expiryVariant(override: PolicyOverrideRecord): "default" | "warning" {
  if (!override.expires_at) return "default";
  const expiresAt = Date.parse(override.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt > Date.now()) return "default";
  return "warning";
}

function agentLabel(agent: PolicyAgentOption | undefined): string {
  if (!agent) return "Unknown agent";
  return agent.displayName === agent.agentKey
    ? agent.agentKey
    : `${agent.displayName} (${agent.agentKey})`;
}

function resolvedToolId(selectedToolId: string, customToolId: string): string {
  return (selectedToolId === "__custom__" ? customToolId : selectedToolId).trim();
}

function isDateTimeLocalValue(raw: string): boolean {
  if (!raw.trim()) return true;
  return Number.isFinite(Date.parse(raw));
}

function wildcardHelper(toolId: string): string {
  if (toolId === "connector.send") {
    return "Use exact destinations when possible, for example `telegram:work:123`.";
  }
  if (toolId === "tool.node.dispatch") {
    return "Prefer narrow capability/action targets instead of broad `*` patterns.";
  }
  return "Use `*` for many characters and `?` for one. Avoid broad leading wildcards when possible.";
}

export function PolicyOverridesSection(props: PolicyOverridesSectionProps): React.ReactElement {
  const [agentId, setAgentId] = React.useState("");
  const [workspaceId, setWorkspaceId] = React.useState("");
  const [selectedToolId, setSelectedToolId] = React.useState("");
  const [customToolId, setCustomToolId] = React.useState("");
  const [pattern, setPattern] = React.useState("");
  const [expiresAt, setExpiresAt] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [statusFilter, setStatusFilter] = React.useState<"all" | PolicyOverrideRecord["status"]>(
    "all",
  );
  const [agentFilter, setAgentFilter] = React.useState("all");
  const [toolFilter, setToolFilter] = React.useState("all");
  const [revokeTarget, setRevokeTarget] = React.useState<PolicyOverrideRecord | null>(null);
  const [revokeReason, setRevokeReason] = React.useState("");

  const toolId = resolvedToolId(selectedToolId, customToolId);
  const canCreate =
    agentId.trim().length > 0 &&
    toolId.length > 0 &&
    pattern.trim().length > 0 &&
    isDateTimeLocalValue(expiresAt);

  const filteredOverrides = props.overrides.filter((override) => {
    if (statusFilter !== "all" && override.status !== statusFilter) return false;
    if (agentFilter !== "all" && override.agent_id !== agentFilter) return false;
    if (toolFilter !== "all" && override.tool_id !== toolFilter) return false;
    return true;
  });

  const agentsById = new Map(props.agents.map((agent) => [agent.agentId, agent]));
  const toolsById = new Map(props.tools.map((tool) => [tool.toolId, tool]));

  return (
    <>
      <Card data-testid="policy-overrides-section">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="grid gap-0.5">
              <div className="text-sm font-medium text-fg">Overrides</div>
              <div className="text-sm text-fg-muted">
                Durable, auditable exceptions that turn future approval prompts into allows for
                narrow matches.
              </div>
            </div>
            <Button
              variant="secondary"
              data-testid="admin-policy-overrides-refresh"
              isLoading={props.loadBusy}
              onClick={props.onRefresh}
            >
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Alert
            variant="warning"
            title="Use narrow override patterns"
            description="Overrides affect the whole deployment policy outcome for matching actions. Prefer exact targets or tight prefixes."
          />
          {props.loadError ? (
            <Alert
              variant="error"
              title="Overrides failed to load"
              description={formatErrorMessage(props.loadError)}
            />
          ) : null}
          {props.createError ? (
            <Alert
              variant="error"
              title="Override creation failed"
              description={formatErrorMessage(props.createError)}
            />
          ) : null}
          {props.revokeError ? (
            <Alert
              variant="error"
              title="Override revocation failed"
              description={formatErrorMessage(props.revokeError)}
            />
          ) : null}
          <div className="grid gap-4 rounded-lg border border-border p-4">
            <div className="grid gap-0.5">
              <div className="text-sm font-medium text-fg">Create override</div>
              <div className="text-sm text-fg-muted">
                Start from agent, tool, and exact match target. Add expiry unless the rule is
                genuinely long-lived.
              </div>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Select
                label="Agent"
                required={true}
                data-testid="admin-policy-override-agent"
                value={agentId}
                helperText="Overrides are always scoped to an agent."
                onChange={(event) => setAgentId(event.currentTarget.value)}
              >
                <option value="">Select an agent</option>
                {props.agents.map((agent) => (
                  <option key={agent.agentId} value={agent.agentId}>
                    {agentLabel(agent)}
                  </option>
                ))}
              </Select>
              <Input
                label="Workspace ID"
                data-testid="admin-policy-override-workspace"
                placeholder="Optional"
                helperText="Provide only for workspace-scoped tools."
                value={workspaceId}
                onChange={(event) => setWorkspaceId(event.currentTarget.value)}
              />
              <Select
                label="Tool"
                required={true}
                data-testid="admin-policy-override-tool"
                value={selectedToolId}
                helperText="Select a known tool or switch to a custom tool ID."
                onChange={(event) => setSelectedToolId(event.currentTarget.value)}
              >
                <option value="">Select a tool</option>
                {props.tools.map((tool) => (
                  <option key={tool.toolId} value={tool.toolId}>
                    {tool.toolId}
                  </option>
                ))}
                <option value="__custom__">Custom tool ID</option>
              </Select>
              {selectedToolId === "__custom__" ? (
                <Input
                  label="Custom tool ID"
                  required={true}
                  data-testid="admin-policy-override-tool-custom"
                  value={customToolId}
                  onChange={(event) => setCustomToolId(event.currentTarget.value)}
                />
              ) : null}
              <Input
                label="Match pattern"
                required={true}
                data-testid="admin-policy-override-pattern"
                helperText={wildcardHelper(toolId)}
                value={pattern}
                onChange={(event) => setPattern(event.currentTarget.value)}
              />
              <Input
                label="Expires at"
                type="datetime-local"
                data-testid="admin-policy-override-expires-at"
                error={isDateTimeLocalValue(expiresAt) ? undefined : "Use a valid date and time."}
                helperText="Leave blank for no expiry."
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.currentTarget.value)}
              />
            </div>
          </div>
          <Card className="border-dashed">
            <CardHeader>
              <div className="text-sm font-medium text-fg">Inventory filters</div>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-3">
              <Select
                label="Status"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.currentTarget.value as typeof statusFilter)
                }
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="revoked">Revoked</option>
                <option value="expired">Expired</option>
              </Select>
              <Select
                label="Agent"
                value={agentFilter}
                onChange={(event) => setAgentFilter(event.currentTarget.value)}
              >
                <option value="all">All agents</option>
                {props.agents.map((agent) => (
                  <option key={agent.agentId} value={agent.agentId}>
                    {agentLabel(agent)}
                  </option>
                ))}
              </Select>
              <Select
                label="Tool"
                value={toolFilter}
                onChange={(event) => setToolFilter(event.currentTarget.value)}
              >
                <option value="all">All tools</option>
                {props.tools.map((tool) => (
                  <option key={tool.toolId} value={tool.toolId}>
                    {tool.toolId}
                  </option>
                ))}
              </Select>
            </CardContent>
          </Card>
          <div className="flex flex-wrap gap-2">
            <Badge>{`${filteredOverrides.length} shown`}</Badge>
            <Badge variant="outline">{`${props.overrides.filter((override) => override.status === "active").length} active`}</Badge>
          </div>
          {filteredOverrides.length === 0 ? (
            <Alert
              variant="info"
              title="No overrides match the current filters"
              description="Adjust the filters above or create a new narrow override."
            />
          ) : null}
          {filteredOverrides.map((override) => (
            <div
              key={override.policy_override_id}
              className="grid gap-3 rounded-lg border border-border p-4 md:grid-cols-[1fr_auto]"
              data-testid={`policy-override-row-${override.policy_override_id}`}
            >
              <div className="grid gap-2">
                <div className="flex flex-wrap gap-2">
                  <Badge variant={statusVariant(override.status)}>{override.status}</Badge>
                  <Badge variant={expiryVariant(override)}>
                    {override.expires_at
                      ? `Expires ${formatTimestamp(override.expires_at, "Never")}`
                      : "No expiry"}
                  </Badge>
                  <Badge variant="outline">{override.tool_id}</Badge>
                </div>
                <div className="grid gap-1 text-sm text-fg-muted">
                  <div>
                    <span className="font-medium text-fg">Agent:</span>{" "}
                    {agentLabel(agentsById.get(override.agent_id))}
                  </div>
                  <div>
                    <span className="font-medium text-fg">Pattern:</span> {override.pattern}
                  </div>
                  <div>
                    <span className="font-medium text-fg">Workspace:</span>{" "}
                    {override.workspace_id?.trim() || "Any workspace"}
                  </div>
                  <div>
                    <span className="font-medium text-fg">Created:</span>{" "}
                    {formatTimestamp(override.created_at)}
                  </div>
                  {override.status === "revoked" ? (
                    <div>
                      <span className="font-medium text-fg">Revoked reason:</span>{" "}
                      {override.revoked_reason?.trim() || "None provided"}
                    </div>
                  ) : null}
                  {toolsById.get(override.tool_id)?.description ? (
                    <div>
                      <span className="font-medium text-fg">Tool summary:</span>{" "}
                      {toolsById.get(override.tool_id)?.description}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="flex items-end">
                <ElevatedModeTooltip canMutate={props.canMutate} requestEnter={props.requestEnter}>
                  <Button
                    variant="danger"
                    data-testid={`policy-override-revoke-${override.policy_override_id}`}
                    disabled={override.status !== "active"}
                    isLoading={
                      props.revokeBusy &&
                      revokeTarget?.policy_override_id === override.policy_override_id
                    }
                    onClick={() => {
                      setRevokeTarget(override);
                      setRevokeReason("");
                    }}
                  >
                    Revoke
                  </Button>
                </ElevatedModeTooltip>
              </div>
            </div>
          ))}
        </CardContent>
        <CardFooter>
          <ElevatedModeTooltip canMutate={props.canMutate} requestEnter={props.requestEnter}>
            <Button
              variant="danger"
              data-testid="admin-policy-override-create"
              disabled={!canCreate}
              isLoading={props.createBusy}
              onClick={() => setCreateOpen(true)}
            >
              Create override
            </Button>
          </ElevatedModeTooltip>
        </CardFooter>
      </Card>

      <ConfirmDangerDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Create policy override"
        description="This saves a durable deployment-wide exception for future matching actions."
        confirmLabel="Create override"
        isLoading={props.createBusy}
        onConfirm={async () => {
          const created = await props.onCreate({
            agent_id: agentId.trim(),
            ...(workspaceId.trim() ? { workspace_id: workspaceId.trim() } : {}),
            tool_id: toolId,
            pattern: pattern.trim(),
            ...(expiresAt.trim() ? { expires_at: new Date(expiresAt).toISOString() } : {}),
          });
          if (!created) return;
          setAgentId("");
          setWorkspaceId("");
          setSelectedToolId("");
          setCustomToolId("");
          setPattern("");
          setExpiresAt("");
        }}
      >
        <div className="grid gap-2 text-sm text-fg-muted">
          <div>
            <span className="font-medium text-fg">Agent:</span>{" "}
            {agentLabel(props.agents.find((agent) => agent.agentId === agentId))}
          </div>
          <div>
            <span className="font-medium text-fg">Tool:</span> {toolId}
          </div>
          <div>
            <span className="font-medium text-fg">Pattern:</span> {pattern.trim()}
          </div>
          <div>
            <span className="font-medium text-fg">Expiry:</span>{" "}
            {expiresAt.trim() ? new Date(expiresAt).toISOString() : "No expiry"}
          </div>
        </div>
      </ConfirmDangerDialog>

      <ConfirmDangerDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (open) return;
          setRevokeTarget(null);
          setRevokeReason("");
        }}
        title="Revoke policy override"
        description="Revoking an override is audited and takes effect for future matching actions."
        confirmLabel="Revoke override"
        isLoading={props.revokeBusy}
        onConfirm={async () => {
          if (!revokeTarget || !revokeReason.trim()) {
            throw new Error("A revocation reason is required.");
          }
          await props.onRevoke({
            policy_override_id: revokeTarget.policy_override_id,
            reason: revokeReason.trim(),
          });
        }}
      >
        <div className="grid gap-4">
          <div className="grid gap-1 text-sm text-fg-muted">
            <div>
              <span className="font-medium text-fg">Tool:</span>{" "}
              {revokeTarget?.tool_id ?? "Unknown"}
            </div>
            <div>
              <span className="font-medium text-fg">Pattern:</span>{" "}
              {revokeTarget?.pattern ?? "Unknown"}
            </div>
          </div>
          <Textarea
            label="Revocation reason"
            required={true}
            data-testid="policy-override-revoke-reason"
            error={revokeReason.trim() ? undefined : "Reason is required."}
            value={revokeReason}
            onChange={(event) => setRevokeReason(event.currentTarget.value)}
          />
        </div>
      </ConfirmDangerDialog>
    </>
  );
}
