import {
  isPairingHumanActionableStatus,
  type OperatorCore,
  type Pairing,
} from "@tyrum/operator-core";
import type { CapabilityDescriptor, NodeInventoryEntry } from "@tyrum/contracts";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { Checkbox } from "../ui/checkbox.js";
import { Label } from "../ui/label.js";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group.js";
import { Textarea } from "../ui/textarea.js";
import { cn } from "../../lib/cn.js";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { extractTakeoverUrlFromNodeIdentity } from "../../utils/takeover-url.js";
import { isAdminAccessRequiredError } from "../elevated-mode/admin-access-error.js";
import { useAdminMutationAccess } from "./admin-http-shared.js";
import {
  getPairingStatusDisplay,
  NodeDetails,
  NodeInventoryBadges,
  ReviewContext,
  type AttachmentKind,
  useMountedRef,
} from "./pairing-page.shared.js";

type PairingTrustLevel = "local" | "remote";

type PendingPairingDetailsProps = {
  core: OperatorCore;
  pairing: Pairing;
  inventory?: NodeInventoryEntry;
  attachmentKind: AttachmentKind;
};

export function PendingPairingDetails({
  core,
  pairing,
  inventory,
  attachmentKind,
}: PendingPairingDetailsProps) {
  const mountedRef = useMountedRef();
  const { canMutate, requestEnter } = useAdminMutationAccess(core);

  const initialTrustLevel = (pairing.trust_level ?? "local") satisfies PairingTrustLevel;
  const [trustLevel, setTrustLevel] = useState<PairingTrustLevel>(initialTrustLevel);
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);

  const capabilityOptions = useMemo<CapabilityDescriptor[]>(() => {
    if (pairing.capability_allowlist.length > 0) {
      return pairing.capability_allowlist;
    }

    return pairing.node.capabilities;
  }, [pairing.capability_allowlist, pairing.node.capabilities]);

  const [selectedCapabilityIds, setSelectedCapabilityIds] = useState<Set<string>>(
    () => new Set(capabilityOptions.map((capability: CapabilityDescriptor) => capability.id)),
  );
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);
  const isBusy = busy !== null;
  const actionable = isPairingHumanActionableStatus(pairing.status);
  const statusDisplay = getPairingStatusDisplay(pairing.status);
  const takeoverUrl = extractTakeoverUrlFromNodeIdentity(pairing.node);

  const onApprove = async (): Promise<void> => {
    if (busy) return;
    if (!canMutate) {
      requestEnter();
      return;
    }
    setBusy("approve");
    try {
      const trimmedReason = reasonRef.current?.value.trim() ?? "";
      const capability_allowlist = capabilityOptions.filter((capability: CapabilityDescriptor) =>
        selectedCapabilityIds.has(capability.id),
      );
      await core.pairingStore.approve(pairing.pairing_id, {
        trust_level: trustLevel,
        capability_allowlist,
        ...(trimmedReason ? { reason: trimmedReason } : {}),
      });
      toast.success("Node approved");
    } catch (error) {
      if (isAdminAccessRequiredError(error)) {
        requestEnter();
        return;
      }
      toast.error(formatErrorMessage(error));
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  const onDeny = async (): Promise<void> => {
    if (busy) return;
    if (!canMutate) {
      requestEnter();
      return;
    }
    setBusy("deny");
    try {
      const trimmedReason = reasonRef.current?.value.trim() ?? "";
      await core.pairingStore.deny(
        pairing.pairing_id,
        trimmedReason ? { reason: trimmedReason } : undefined,
      );
      toast.success("Node denied");
    } catch (error) {
      if (isAdminAccessRequiredError(error)) {
        requestEnter();
        return;
      }
      toast.error(formatErrorMessage(error));
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-medium text-fg">Node request</div>
          <Badge variant={statusDisplay.variant}>{statusDisplay.label}</Badge>
        </div>
        <div className="text-sm text-fg-muted">
          Node <span className="break-all font-medium text-fg">{pairing.node.node_id}</span>
        </div>
        {pairing.node.label ? (
          <div className="text-xs text-fg-muted">{pairing.node.label}</div>
        ) : null}
        <NodeInventoryBadges
          pairingId={pairing.pairing_id}
          inventory={inventory}
          attachmentKind={attachmentKind}
        />
        <NodeDetails node={pairing.node} requestedAt={pairing.requested_at} />
        {takeoverUrl ? (
          <Button asChild size="sm" variant="outline" className="w-fit">
            <a
              data-testid={`pairing-takeover-${pairing.pairing_id}`}
              href={takeoverUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              Open takeover
            </a>
          </Button>
        ) : null}
      </div>

      <div className="grid gap-6">
        <ReviewContext
          motivation={pairing.motivation}
          review={pairing.latest_review}
          testIdPrefix={`pairing-${pairing.pairing_id}`}
        />
        {actionable ? (
          <>
            <fieldset className="grid gap-3">
              <legend className="text-sm font-medium leading-none text-fg">
                Trust level{" "}
                <span aria-hidden="true" className="text-error">
                  *
                </span>
              </legend>
              <RadioGroup
                value={trustLevel}
                onValueChange={(value) => {
                  if (value === "local" || value === "remote") {
                    setTrustLevel(value);
                  }
                }}
                className="grid gap-3"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem
                    id={`pairing-${pairing.pairing_id}-trust-local`}
                    data-testid={`pairing-trust-level-${pairing.pairing_id}-local`}
                    value="local"
                    disabled={isBusy}
                  />
                  <Label htmlFor={`pairing-${pairing.pairing_id}-trust-local`}>Local</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem
                    id={`pairing-${pairing.pairing_id}-trust-remote`}
                    data-testid={`pairing-trust-level-${pairing.pairing_id}-remote`}
                    value="remote"
                    disabled={isBusy}
                  />
                  <Label htmlFor={`pairing-${pairing.pairing_id}-trust-remote`}>Remote</Label>
                </div>
              </RadioGroup>
            </fieldset>

            <fieldset className="grid gap-3">
              <legend className="text-sm font-medium leading-none text-fg">Capabilities</legend>
              {capabilityOptions.length === 0 ? (
                <div className="text-sm text-fg-muted">No capabilities available.</div>
              ) : (
                <div className="grid gap-2">
                  {capabilityOptions.map((capability: CapabilityDescriptor, index: number) => {
                    const checkboxId = `pairing-${pairing.pairing_id}-cap-${capability.id}`;
                    const checked = selectedCapabilityIds.has(capability.id);
                    return (
                      <div key={checkboxId} className="flex items-start gap-2">
                        <Checkbox
                          id={checkboxId}
                          data-testid={`pairing-capability-${pairing.pairing_id}-${index}`}
                          checked={checked}
                          disabled={isBusy}
                          onCheckedChange={(nextChecked) => {
                            setSelectedCapabilityIds((prev) => {
                              const next = new Set(prev);
                              if (nextChecked === true) {
                                next.add(capability.id);
                              } else {
                                next.delete(capability.id);
                              }
                              return next;
                            });
                          }}
                        />
                        <Label
                          htmlFor={checkboxId}
                          className="break-words text-sm font-normal text-fg [overflow-wrap:anywhere]"
                        >
                          {capability.id}
                        </Label>
                      </div>
                    );
                  })}
                </div>
              )}
            </fieldset>

            <Textarea
              data-testid={`pairing-reason-${pairing.pairing_id}`}
              label="Reason"
              rows={3}
              ref={reasonRef}
              placeholder="Optional"
              disabled={isBusy}
            />
          </>
        ) : (
          <div className="text-sm text-fg-muted">
            {pairing.status === "queued"
              ? "Queued for guardian review."
              : "Guardian review is in progress."}
          </div>
        )}
      </div>

      {actionable ? (
        <div className="flex flex-wrap gap-2">
          <Button
            data-testid={`pairing-approve-${pairing.pairing_id}`}
            isLoading={busy === "approve"}
            disabled={isBusy}
            onClick={() => {
              void onApprove();
            }}
          >
            Approve
          </Button>
          <Button
            variant="secondary"
            data-testid={`pairing-deny-${pairing.pairing_id}`}
            isLoading={busy === "deny"}
            disabled={isBusy}
            onClick={() => {
              void onDeny();
            }}
          >
            Deny
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function PendingPairingCard({
  core,
  pairing,
  inventory,
  attachmentKind,
}: PendingPairingDetailsProps) {
  return (
    <Card
      data-testid={`pairing-card-${pairing.pairing_id}`}
      className={cn(attachmentKind === "local" && "border-primary/40 bg-primary/5")}
    >
      <div className="grid gap-6 p-4 sm:p-5">
        <PendingPairingDetails
          core={core}
          pairing={pairing}
          inventory={inventory}
          attachmentKind={attachmentKind}
        />
      </div>
    </Card>
  );
}

type ApprovedPairingDetailsProps = {
  core: OperatorCore;
  pairing: Pairing;
  inventory?: NodeInventoryEntry;
  attachmentKind: AttachmentKind;
};

export function ApprovedPairingDetails({
  core,
  pairing,
  inventory,
  attachmentKind,
}: ApprovedPairingDetailsProps) {
  const mountedRef = useMountedRef();
  const { canMutate, requestEnter } = useAdminMutationAccess(core);

  const [busy, setBusy] = useState(false);

  const onRevoke = async (): Promise<void> => {
    if (busy) return;
    if (!canMutate) {
      requestEnter();
      return;
    }
    setBusy(true);
    try {
      await core.pairingStore.revoke(pairing.pairing_id);
    } catch (error) {
      if (isAdminAccessRequiredError(error)) {
        requestEnter();
        return;
      }
      toast.error(formatErrorMessage(error));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <div className="text-sm font-medium text-fg">Trusted node</div>
        <div className="text-sm text-fg-muted">
          Node <span className="break-all font-medium text-fg">{pairing.node.node_id}</span>
        </div>
        {pairing.node.label ? (
          <div className="text-xs text-fg-muted">{pairing.node.label}</div>
        ) : null}
        <NodeInventoryBadges
          pairingId={pairing.pairing_id}
          inventory={inventory}
          attachmentKind={attachmentKind}
        />
        <NodeDetails node={pairing.node} />
        {pairing.trust_level ? (
          <div className="text-sm text-fg-muted">
            Trust level <span className="font-medium text-fg">{pairing.trust_level}</span>
          </div>
        ) : null}
      </div>

      <div className="grid gap-6">
        <ReviewContext
          motivation={pairing.motivation}
          review={pairing.latest_review}
          testIdPrefix={`pairing-${pairing.pairing_id}`}
        />
      </div>

      <div>
        <Button
          variant="danger"
          data-testid={`pairing-revoke-${pairing.pairing_id}`}
          isLoading={busy}
          onClick={() => {
            void onRevoke();
          }}
        >
          Revoke
        </Button>
      </div>
    </div>
  );
}

export function ApprovedPairingCard({
  core,
  pairing,
  inventory,
  attachmentKind,
}: ApprovedPairingDetailsProps) {
  return (
    <Card
      data-testid={`pairing-card-${pairing.pairing_id}`}
      className={cn(attachmentKind === "local" && "border-primary/40 bg-primary/5")}
    >
      <div className="grid gap-6 p-4 sm:p-5">
        <ApprovedPairingDetails
          core={core}
          pairing={pairing}
          inventory={inventory}
          attachmentKind={attachmentKind}
        />
      </div>
    </Card>
  );
}
