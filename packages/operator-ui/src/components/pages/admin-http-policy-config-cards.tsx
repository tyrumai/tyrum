import * as React from "react";
import { useI18n } from "../../i18n-helpers.js";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { ElevatedModeTooltip } from "../elevated-mode/elevated-mode-tooltip.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import type {
  PolicyConfigRevision,
  PolicyEffectiveBundle,
} from "./admin-http-policy-config-types.js";
import {
  formatTimestamp,
  SectionHeading,
  sourceLabel,
} from "./admin-http-policy-config-primitives.js";

function createdByLabel(value: unknown): string {
  if (!value || typeof value !== "object") return "Unknown";
  if ("token_id" in value && typeof value.token_id === "string") {
    return value.token_id;
  }
  return "Saved via operator";
}

export function OverviewCard(props: {
  effective: PolicyEffectiveBundle;
  currentRevision: PolicyConfigRevision | null;
  dirty: boolean;
  onRefresh: () => void;
  loadBusy: boolean;
}): React.ReactElement {
  const intl = useI18n();
  return (
    <Card data-testid="policy-config-overview">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHeading
            title="Deployment policy overview"
            description="This controls the deployment-wide baseline before any agent or playbook-specific tightening."
          />
          <Button
            variant="secondary"
            isLoading={props.loadBusy}
            data-testid="policy-config-refresh"
            onClick={props.onRefresh}
          >
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant={props.effective.sources.deployment === "default" ? "warning" : "success"}>
            {sourceLabel(intl, props.effective.sources.deployment)}
          </Badge>
          <Badge variant="outline">SHA {props.effective.sha256.slice(0, 12)}</Badge>
          {props.dirty ? (
            <Badge variant="warning">Unsaved changes</Badge>
          ) : (
            <Badge variant="success">Saved</Badge>
          )}
        </div>
        {props.effective.sources.deployment === "default" ? (
          <Alert
            variant="info"
            title="Using the built-in default policy"
            description="There is no saved deployment policy revision yet. Your first save will create revision 1."
          />
        ) : null}
        <div className="grid gap-3 text-sm text-fg-muted md:grid-cols-2">
          <div>
            <span className="font-medium text-fg">Current revision:</span>{" "}
            {props.currentRevision?.revision ?? "Default only"}
          </div>
          <div>
            <span className="font-medium text-fg">Last saved:</span>{" "}
            {formatTimestamp(intl, props.currentRevision?.created_at)}
          </div>
          <div>
            <span className="font-medium text-fg">Saved by:</span>{" "}
            {createdByLabel(props.currentRevision?.created_by)}
          </div>
          <div>
            <span className="font-medium text-fg">Reason:</span>{" "}
            {props.currentRevision?.reason?.trim() || "None provided"}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function RevisionHistoryCard(props: {
  revisions: PolicyConfigRevision[];
  configUnavailable: boolean;
  busy: boolean;
  error: unknown;
  canMutate: boolean;
  requestEnter: () => void;
  onRevert: (revision: PolicyConfigRevision) => void;
}): React.ReactElement {
  const intl = useI18n();
  const [errorDismissed, setErrorDismissed] = React.useState(false);
  React.useEffect(() => {
    setErrorDismissed(false);
  }, [props.error]);

  return (
    <Card data-testid="policy-config-history">
      <CardHeader>
        <SectionHeading
          title="Revision history"
          description="Reverting creates a new revision based on the selected prior revision."
        />
      </CardHeader>
      <CardContent className="grid gap-4">
        {props.configUnavailable ? (
          <Alert
            variant="info"
            title="Revision history unavailable"
            description="This gateway is not exposing deployment policy revision routes, so this view is read-only."
          />
        ) : null}
        {props.error && !errorDismissed ? (
          <Alert
            variant="error"
            title="Policy history failed to load"
            description={formatErrorMessage(props.error)}
            onDismiss={() => setErrorDismissed(true)}
          />
        ) : null}
        {!props.configUnavailable && !props.error && props.revisions.length === 0 ? (
          <Alert
            variant="info"
            title="No saved revisions yet"
            description="The gateway is still using the built-in default deployment policy."
          />
        ) : null}
        {props.revisions.map((revision) => (
          <div
            key={revision.revision}
            className="grid gap-3 rounded-lg border border-border p-4 md:grid-cols-[1fr_auto]"
            data-testid={`policy-config-revision-${revision.revision}`}
          >
            <div className="grid gap-1 text-sm text-fg-muted">
              <div className="font-medium text-fg">Revision {revision.revision}</div>
              <div>Saved: {formatTimestamp(intl, revision.created_at)}</div>
              <div>Saved by: {createdByLabel(revision.created_by)}</div>
              <div>Reason: {revision.reason?.trim() || "None provided"}</div>
              <div>
                Reverted from:{" "}
                {revision.reverted_from_revision === undefined ||
                revision.reverted_from_revision === null
                  ? "No"
                  : `Revision ${revision.reverted_from_revision}`}
              </div>
            </div>
            <div className="flex items-end">
              <ElevatedModeTooltip canMutate={props.canMutate} requestEnter={props.requestEnter}>
                <Button
                  variant="danger"
                  data-testid={`policy-config-revert-${revision.revision}`}
                  isLoading={props.busy}
                  onClick={() => props.onRevert(revision)}
                >
                  Revert
                </Button>
              </ElevatedModeTooltip>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
