import type { PolicyBundle as PolicyBundleT } from "@tyrum/schemas";
import * as React from "react";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { ElevatedModeTooltip } from "../elevated-mode/elevated-mode-tooltip.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardFooter, CardHeader } from "../ui/card.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import { Input } from "../ui/input.js";
import { Select } from "../ui/select.js";
import { Separator } from "../ui/separator.js";
import { ArtifactsEditor } from "./admin-http-policy-config-artifacts.js";
import { OverviewCard, RevisionHistoryCard } from "./admin-http-policy-config-cards.js";
import {
  DomainEditor,
  formatTimestamp,
  SectionHeading,
  sourceLabel,
} from "./admin-http-policy-config-primitives.js";
import type {
  PolicyConfigDeployment,
  PolicyConfigRevision,
  PolicyConfigSectionProps,
  PolicyEffectiveBundle,
} from "./admin-http-policy-config-types.js";
import {
  policyBundleToFormState,
  policyFormStateToBundle,
  stringifyPolicyBundle,
  type PolicyFormState,
} from "./admin-http-policy-shared.js";

export type {
  PolicyConfigDeployment,
  PolicyConfigRevision,
  PolicyConfigSectionProps,
  PolicyEffectiveBundle,
};

const EMPTY_POLICY_BUNDLE: PolicyBundleT = {
  v: 1,
  approvals: {
    auto_review: {
      mode: "auto_review",
    },
  },
};

function normalizePolicyBundle(bundle: PolicyBundleT): PolicyBundleT {
  return policyFormStateToBundle(policyBundleToFormState(bundle));
}

export function PolicyConfigSection(props: PolicyConfigSectionProps): React.ReactElement {
  const [formState, setFormState] = React.useState<PolicyFormState | null>(null);
  const [initialBundle, setInitialBundle] = React.useState<PolicyBundleT | null>(null);
  const [saveReason, setSaveReason] = React.useState("");
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [revertReason, setRevertReason] = React.useState("");
  const [revertTarget, setRevertTarget] = React.useState<PolicyConfigRevision | null>(null);
  const skipNextPropBundleSignatureRef = React.useRef<string | null>(null);
  const lastAppliedDeploymentBundleSignatureRef = React.useRef<string | null>(null);

  const applyBundleToEditor = React.useCallback((bundle: PolicyBundleT): string => {
    const normalizedBundle = normalizePolicyBundle(bundle);
    const normalizedSignature = stringifyPolicyBundle(normalizedBundle);
    setFormState(policyBundleToFormState(normalizedBundle));
    setInitialBundle(normalizedBundle);
    return normalizedSignature;
  }, []);

  React.useEffect(() => {
    if (!props.effective) return;
    const deploymentBundle =
      props.currentRevision?.bundle ??
      (props.configUnavailable ? props.effective.bundle : EMPTY_POLICY_BUNDLE);
    const deploymentBundleSignature = stringifyPolicyBundle(deploymentBundle);
    if (skipNextPropBundleSignatureRef.current === deploymentBundleSignature) {
      skipNextPropBundleSignatureRef.current = null;
      lastAppliedDeploymentBundleSignatureRef.current = deploymentBundleSignature;
      setSaveReason("");
      return;
    }
    if (lastAppliedDeploymentBundleSignatureRef.current === deploymentBundleSignature) {
      return;
    }
    applyBundleToEditor(deploymentBundle);
    lastAppliedDeploymentBundleSignatureRef.current = deploymentBundleSignature;
    setSaveReason("");
  }, [applyBundleToEditor, props.currentRevision, props.effective]);

  if (props.loadError && !props.effective) {
    return (
      <Alert
        variant="error"
        title="Policy tab failed to load"
        description={formatErrorMessage(props.loadError)}
      />
    );
  }

  if (!props.effective || !formState || !initialBundle) {
    return (
      <Card data-testid="policy-config-loading">
        <CardHeader>
          <SectionHeading
            title="Loading policy"
            description="Gathering the effective deployment policy, revisions, and supporting metadata."
          />
        </CardHeader>
      </Card>
    );
  }

  const nextBundle = policyFormStateToBundle(formState);
  const dirty = stringifyPolicyBundle(nextBundle) !== stringifyPolicyBundle(initialBundle);

  return (
    <>
      <OverviewCard
        effective={props.effective}
        currentRevision={props.currentRevision}
        dirty={dirty}
        onRefresh={props.onRefresh}
        loadBusy={props.loadBusy}
      />

      {props.configUnavailable ? (
        <Alert
          variant="info"
          title="Deployment policy editing unavailable"
          description="This gateway is not exposing deployment policy config routes, so the editor is read-only and overrides remain available."
        />
      ) : null}

      {props.saveError ? (
        <Alert
          variant="error"
          title="Policy save failed"
          description={formatErrorMessage(props.saveError)}
        />
      ) : null}

      <div className="grid gap-4">
        <Card data-testid="policy-config-approvals">
          <CardHeader>
            <SectionHeading
              title="Approvals"
              description="Choose whether guardian review runs first or every request goes straight to a human reviewer."
            />
          </CardHeader>
          <CardContent className="grid gap-3">
            <Select
              label="Automatic approval review"
              helperText="`Auto review` is the default and keeps guardian review ahead of human intervention."
              value={formState.approvals.autoReviewMode}
              data-testid="policy-config-approvals-auto-review-mode"
              onChange={(event) => {
                const next = event.currentTarget.value;
                if (next !== "auto_review" && next !== "manual_only") return;
                setFormState((prev) =>
                  prev
                    ? {
                        ...prev,
                        approvals: {
                          autoReviewMode: next,
                        },
                      }
                    : prev,
                );
              }}
            >
              <option value="auto_review">Auto review</option>
              <option value="manual_only">Manual only</option>
            </Select>
          </CardContent>
        </Card>
        <DomainEditor
          title="Tools"
          description="Define the baseline tool behavior for the whole deployment."
          state={formState.tools}
          testIdPrefix="policy-config-tools"
          toolMode={true}
          onChange={(next) => setFormState((prev) => (prev ? { ...prev, tools: next } : prev))}
        />
        <DomainEditor
          title="Network egress"
          description="Control outbound network access targets."
          state={formState.networkEgress}
          testIdPrefix="policy-config-network"
          onChange={(next) =>
            setFormState((prev) => (prev ? { ...prev, networkEgress: next } : prev))
          }
        />
        <DomainEditor
          title="Secrets"
          description="Decide which secret-resolution scopes are allowed, approval-gated, or denied."
          state={formState.secrets}
          testIdPrefix="policy-config-secrets"
          onChange={(next) => setFormState((prev) => (prev ? { ...prev, secrets: next } : prev))}
        />
        <DomainEditor
          title="Connectors"
          description="Control connector and messaging scope access."
          state={formState.connectors}
          testIdPrefix="policy-config-connectors"
          onChange={(next) => setFormState((prev) => (prev ? { ...prev, connectors: next } : prev))}
        />
        <ArtifactsEditor
          state={formState.artifacts}
          onChange={(next) => setFormState((prev) => (prev ? { ...prev, artifacts: next } : prev))}
        />
        <Card data-testid="policy-config-provenance">
          <CardHeader>
            <SectionHeading
              title="Provenance"
              description="Tighten shell behavior when the triggering content came from untrusted sources."
            />
          </CardHeader>
          <CardContent className="grid gap-3">
            <Select
              label="Untrusted shell behavior"
              helperText="`Require approval` is the conservative default."
              value={
                formState.provenance.untrustedShellRequiresApproval ? "require_approval" : "allow"
              }
              onChange={(event) =>
                setFormState((prev) =>
                  prev
                    ? {
                        ...prev,
                        provenance: {
                          untrustedShellRequiresApproval:
                            event.currentTarget.value === "require_approval",
                        },
                      }
                    : prev,
                )
              }
            >
              <option value="require_approval">Require approval</option>
              <option value="allow">Allow</option>
            </Select>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="policy-config-save-card">
        <CardHeader>
          <SectionHeading
            title="Save deployment policy"
            description="Review the changes, add an optional reason, then save a new revision."
          />
        </CardHeader>
        <CardContent className="grid gap-4">
          <Input
            label="Reason"
            placeholder="Optional"
            data-testid="policy-config-save-reason"
            value={saveReason}
            onChange={(event) => setSaveReason(event.currentTarget.value)}
          />
          <Alert
            variant={dirty ? "warning" : "success"}
            title={dirty ? "Unsaved changes ready" : "No unsaved changes"}
            description={
              dirty
                ? "Saving creates a new deployment policy revision for the whole gateway."
                : "The editor matches the currently saved deployment policy revision."
            }
          />
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            data-testid="policy-config-reset"
            disabled={props.configUnavailable || !dirty}
            onClick={() => {
              setFormState(policyBundleToFormState(initialBundle));
              setSaveReason("");
            }}
          >
            Reset changes
          </Button>
          <ElevatedModeTooltip canMutate={props.canMutate} requestEnter={props.requestEnter}>
            <Button
              variant="danger"
              data-testid="policy-config-save"
              isLoading={props.saveBusy}
              disabled={props.configUnavailable || !dirty}
              onClick={() => setSaveOpen(true)}
            >
              Save policy
            </Button>
          </ElevatedModeTooltip>
        </CardFooter>
      </Card>

      {props.revertError ? (
        <Alert
          variant="error"
          title="Policy revert failed"
          description={formatErrorMessage(props.revertError)}
        />
      ) : null}

      <RevisionHistoryCard
        revisions={props.revisions}
        configUnavailable={props.configUnavailable}
        busy={props.revertBusy}
        error={props.loadError}
        canMutate={props.canMutate}
        requestEnter={props.requestEnter}
        onRevert={(revision) => {
          setRevertTarget(revision);
          setRevertReason("");
        }}
      />

      <ConfirmDangerDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        title="Save deployment policy"
        description="This creates a new deployment policy revision for the gateway."
        confirmLabel="Save policy"
        isLoading={props.saveBusy}
        onConfirm={async () => {
          const saved = await props.onSave(nextBundle, saveReason);
          if (!saved) return;
          skipNextPropBundleSignatureRef.current = applyBundleToEditor(nextBundle);
          setSaveReason("");
        }}
      >
        <div className="grid gap-3 text-sm text-fg-muted">
          <div>
            <span className="font-medium text-fg">Current source:</span>{" "}
            {sourceLabel(props.effective.sources.deployment)}
          </div>
          <div>
            <span className="font-medium text-fg">Current revision:</span>{" "}
            {props.currentRevision?.revision ?? "Default only"}
          </div>
          <div>
            <span className="font-medium text-fg">Reason:</span> {saveReason.trim() || "None"}
          </div>
        </div>
      </ConfirmDangerDialog>

      <ConfirmDangerDialog
        open={revertTarget !== null}
        onOpenChange={(open) => {
          if (open) return;
          setRevertTarget(null);
          setRevertReason("");
        }}
        title={`Revert to revision ${revertTarget?.revision ?? ""}`}
        description="This creates a new revision from the selected earlier deployment policy."
        confirmLabel="Revert policy"
        isLoading={props.revertBusy}
        onConfirm={async () => {
          if (!revertTarget) return;
          await props.onRevert(revertTarget.revision, revertReason);
        }}
      >
        <div className="grid gap-4">
          <div className="grid gap-2 text-sm text-fg-muted">
            <div>
              <span className="font-medium text-fg">Selected revision:</span>{" "}
              {revertTarget?.revision ?? "Unknown"}
            </div>
            <div>
              <span className="font-medium text-fg">Saved:</span>{" "}
              {formatTimestamp(revertTarget?.created_at)}
            </div>
          </div>
          <Separator />
          <Input
            label="Reason"
            placeholder="Optional"
            value={revertReason}
            onChange={(event) => setRevertReason(event.currentTarget.value)}
          />
        </div>
      </ConfirmDangerDialog>
    </>
  );
}
