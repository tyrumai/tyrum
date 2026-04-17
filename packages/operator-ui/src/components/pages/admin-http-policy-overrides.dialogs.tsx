import * as React from "react";
import { useTranslateNode } from "../../i18n-helpers.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import { Textarea } from "../ui/textarea.js";
import {
  PolicyToolMetadataPanel,
  agentLabel,
  resolvePolicyTool,
  type PolicyAgentOption,
  type PolicyOverrideRecord,
  type ResolvedPolicyTool,
} from "./admin-http-policy-overrides.shared.js";

export function PolicyOverrideDialogs({
  createOpen,
  setCreateOpen,
  createBusy,
  toolMetadataUnavailable,
  toolMetadataIssue,
  agentId,
  workspaceId,
  toolId,
  pattern,
  expiresAt,
  selectedTool,
  agents,
  onCreate,
  onCreated,
  revokeTarget,
  setRevokeTarget,
  revokeReason,
  setRevokeReason,
  revokeBusy,
  toolLookup,
  onRevoke,
}: {
  createOpen: boolean;
  setCreateOpen: (open: boolean) => void;
  createBusy: boolean;
  toolMetadataUnavailable: boolean;
  toolMetadataIssue: string | null;
  agentId: string;
  workspaceId: string;
  toolId: string;
  pattern: string;
  expiresAt: string;
  selectedTool: ResolvedPolicyTool | null;
  agents: PolicyAgentOption[];
  onCreate: (input: {
    agent_id: string;
    workspace_id?: string;
    tool_id: string;
    pattern: string;
    expires_at?: string;
  }) => Promise<boolean>;
  onCreated: () => void;
  revokeTarget: PolicyOverrideRecord | null;
  setRevokeTarget: (override: PolicyOverrideRecord | null) => void;
  revokeReason: string;
  setRevokeReason: (reason: string) => void;
  revokeBusy: boolean;
  toolLookup: ReadonlyMap<string, ResolvedPolicyTool>;
  onRevoke: (input: { policy_override_id: string; reason: string }) => Promise<void | false>;
}): React.ReactElement {
  const translateNode = useTranslateNode();

  return (
    <>
      <ConfirmDangerDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Create policy override"
        description="This saves a durable deployment-wide exception for future matching actions."
        confirmLabel="Create override"
        isLoading={createBusy}
        onConfirm={async () => {
          if (toolMetadataUnavailable) {
            return false;
          }
          const created = await onCreate({
            agent_id: agentId.trim(),
            ...(workspaceId.trim() ? { workspace_id: workspaceId.trim() } : {}),
            tool_id: toolId,
            pattern: pattern.trim(),
            ...(expiresAt.trim() ? { expires_at: new Date(expiresAt).toISOString() } : {}),
          });
          if (created === false) return false;
          if (!created) return;
          onCreated();
        }}
      >
        <div className="grid gap-4 text-sm text-fg-muted">
          <PolicyToolMetadataPanel
            title="Tool"
            toolId={toolId}
            resolved={selectedTool}
            metadataIssue={toolMetadataIssue}
            rawToolIdLabel="Entered tool ID"
            testId="policy-override-create-tool-summary"
          />
          <div>
            <span className="font-medium text-fg">{translateNode("Agent:")}</span>{" "}
            {agentLabel(agents.find((agent) => agent.agentId === agentId))}
          </div>
          <div>
            <span className="font-medium text-fg">{translateNode("Pattern:")}</span>{" "}
            {pattern.trim()}
          </div>
          <div>
            <span className="font-medium text-fg">{translateNode("Expiry:")}</span>{" "}
            {expiresAt.trim() ? new Date(expiresAt).toISOString() : translateNode("No expiry")}
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
        isLoading={revokeBusy}
        onConfirm={async () => {
          if (!revokeTarget || !revokeReason.trim()) {
            throw new Error("A revocation reason is required.");
          }
          return onRevoke({
            policy_override_id: revokeTarget.policy_override_id,
            reason: revokeReason.trim(),
          });
        }}
      >
        <div className="grid gap-4">
          <PolicyToolMetadataPanel
            title="Tool"
            toolId={revokeTarget?.tool_id ?? ""}
            resolved={revokeTarget ? resolvePolicyTool(toolLookup, revokeTarget.tool_id) : null}
            metadataIssue={toolMetadataIssue}
            testId="policy-override-revoke-tool-summary"
          />
          <div className="grid gap-1 text-sm text-fg-muted">
            <div>
              <span className="font-medium text-fg">{translateNode("Pattern:")}</span>{" "}
              {revokeTarget?.pattern ?? translateNode("Unknown")}
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
