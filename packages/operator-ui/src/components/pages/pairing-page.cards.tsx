import {
  isPairingHumanActionableStatus,
  type OperatorCore,
  type Pairing,
} from "@tyrum/operator-core";
import type { CapabilityDescriptor, NodeIdentity, NodeInventoryEntry } from "@tyrum/schemas";
import { type ComponentProps, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardFooter, CardHeader } from "../ui/card.js";
import { Checkbox } from "../ui/checkbox.js";
import { Label } from "../ui/label.js";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group.js";
import { Textarea } from "../ui/textarea.js";
import { cn } from "../../lib/cn.js";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";
import { extractTakeoverUrlFromNodeIdentity } from "../../utils/takeover-url.js";

type PairingTrustLevel = "local" | "remote";
export type AttachmentKind = "none" | "lane" | "local";

const PLATFORM_LABELS: Record<string, string> = {
  darwin: "macOS",
  linux: "Linux",
  win32: "Windows",
};

interface NodeMeta {
  platform: string | null;
  version: string | null;
  mode: string | null;
  ip: string | null;
}

function extractNodeMeta(metadata: unknown): NodeMeta {
  const empty: NodeMeta = { platform: null, version: null, mode: null, ip: null };
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return empty;
  const record = metadata as Record<string, unknown>;
  const str = (key: string) =>
    typeof record[key] === "string" && record[key] ? (record[key] as string) : null;
  return {
    platform: str("platform"),
    version: str("version"),
    mode: str("mode"),
    ip: str("ip"),
  };
}

function getPairingStatusDisplay(status: Pairing["status"] | "pending"): {
  label: string;
  variant: ComponentProps<typeof Badge>["variant"];
} {
  switch (status) {
    case "pending":
      return { label: "Awaiting human review", variant: "warning" };
    case "queued":
      return { label: "Guardian queued", variant: "outline" };
    case "reviewing":
      return { label: "Guardian reviewing", variant: "outline" };
    case "awaiting_human":
      return { label: "Awaiting human review", variant: "warning" };
    case "approved":
      return { label: "Approved", variant: "success" };
    case "denied":
    case "revoked":
      return { label: status, variant: "danger" };
  }
  return { label: status, variant: "outline" };
}

function formatReviewRisk(review: Pairing["latest_review"]): string | null {
  if (!review) return null;
  const parts = [
    review.risk_level ? review.risk_level.toUpperCase() : null,
    typeof review.risk_score === "number" ? `score ${String(review.risk_score)}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function ReviewContext({
  motivation,
  review,
  testIdPrefix,
}: {
  motivation: string;
  review: Pairing["latest_review"];
  testIdPrefix: string;
}) {
  const reviewReason = review?.reason?.trim() ?? "";
  const reviewRisk = formatReviewRisk(review);

  return (
    <>
      <div
        data-testid={`${testIdPrefix}-motivation`}
        className="grid gap-0.5 rounded-md border border-border bg-bg-subtle px-3 py-2.5"
      >
        <div className="text-xs font-medium text-fg-muted">Motivation</div>
        <div className="text-sm text-fg break-words [overflow-wrap:anywhere]">{motivation}</div>
      </div>
      {reviewReason || reviewRisk ? (
        <div
          data-testid={`${testIdPrefix}-review`}
          className="grid gap-1 rounded-md border border-border bg-bg-subtle px-3 py-2.5"
        >
          <div className="text-xs font-medium text-fg-muted">Latest review</div>
          {reviewReason ? (
            <div className="text-sm text-fg break-words [overflow-wrap:anywhere]">
              {reviewReason}
            </div>
          ) : null}
          {reviewRisk ? <div className="text-xs text-fg-muted">Risk {reviewRisk}</div> : null}
        </div>
      ) : null}
    </>
  );
}

function NodeDetails({ node, requestedAt }: { node: NodeIdentity; requestedAt?: string }) {
  const meta = extractNodeMeta(node.metadata);
  const platformLabel = meta.platform ? (PLATFORM_LABELS[meta.platform] ?? meta.platform) : null;

  const details: { label: string; value: string }[] = [];
  if (platformLabel) details.push({ label: "Platform", value: platformLabel });
  if (meta.mode) details.push({ label: "Mode", value: meta.mode });
  if (meta.version) details.push({ label: "Version", value: meta.version });
  if (meta.ip) details.push({ label: "IP", value: meta.ip });
  if (requestedAt) details.push({ label: "Requested", value: formatRelativeTime(requestedAt) });

  if (details.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-fg-muted">
      {details.map((detail) => (
        <span key={detail.label}>
          {detail.label} <span className="font-medium text-fg">{detail.value}</span>
        </span>
      ))}
    </div>
  );
}

function useMountedRef() {
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  return mountedRef;
}

export function resolveAttachmentKind(
  inventory: NodeInventoryEntry | undefined,
  deviceId: string | null | undefined,
): AttachmentKind {
  if (!inventory?.attached_to_requested_lane) return "none";
  if (
    inventory.source_client_device_id &&
    deviceId &&
    inventory.source_client_device_id === deviceId
  ) {
    return "local";
  }
  return "lane";
}

function NodeInventoryBadges({
  pairingId,
  inventory,
  attachmentKind,
}: {
  pairingId: number;
  inventory?: NodeInventoryEntry;
  attachmentKind: AttachmentKind;
}) {
  if (!inventory && attachmentKind === "none") return null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      {inventory ? (
        <Badge
          data-testid={`pairing-connection-${pairingId}`}
          variant={inventory.connected ? "success" : "outline"}
        >
          {inventory.connected ? "Connected" : "Offline"}
        </Badge>
      ) : null}
      {attachmentKind === "local" ? (
        <Badge
          data-testid={`pairing-attached-local-${pairingId}`}
          className="border-primary/25 bg-primary/10 text-primary"
        >
          Attached to this UI
        </Badge>
      ) : null}
      {attachmentKind === "lane" ? (
        <Badge data-testid={`pairing-attached-lane-${pairingId}`} variant="outline">
          Attached to lane
        </Badge>
      ) : null}
    </div>
  );
}

export function PendingPairingCard({
  core,
  pairing,
  inventory,
  attachmentKind,
}: {
  core: OperatorCore;
  pairing: Pairing;
  inventory?: NodeInventoryEntry;
  attachmentKind: AttachmentKind;
}) {
  const mountedRef = useMountedRef();

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
      toast.error(formatErrorMessage(error));
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  const onDeny = async (): Promise<void> => {
    if (busy) return;
    setBusy("deny");
    try {
      const trimmedReason = reasonRef.current?.value.trim() ?? "";
      await core.pairingStore.deny(
        pairing.pairing_id,
        trimmedReason ? { reason: trimmedReason } : undefined,
      );
      toast.success("Node denied");
    } catch (error) {
      toast.error(formatErrorMessage(error));
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  return (
    <Card
      data-testid={`pairing-card-${pairing.pairing_id}`}
      className={cn(attachmentKind === "local" && "border-primary/40 bg-primary/5")}
    >
      <CardHeader className="pb-2.5">
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
      </CardHeader>
      <CardContent className="grid gap-6">
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
      </CardContent>
      {actionable ? (
        <CardFooter className="gap-2">
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
        </CardFooter>
      ) : null}
    </Card>
  );
}

export function ApprovedPairingCard({
  core,
  pairing,
  inventory,
  attachmentKind,
}: {
  core: OperatorCore;
  pairing: Pairing;
  inventory?: NodeInventoryEntry;
  attachmentKind: AttachmentKind;
}) {
  const mountedRef = useMountedRef();

  const [busy, setBusy] = useState(false);

  const onRevoke = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await core.pairingStore.revoke(pairing.pairing_id);
    } catch (error) {
      toast.error(formatErrorMessage(error));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  return (
    <Card
      data-testid={`pairing-card-${pairing.pairing_id}`}
      className={cn(attachmentKind === "local" && "border-primary/40 bg-primary/5")}
    >
      <CardHeader className="pb-2.5">
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
      </CardHeader>
      <CardContent className="grid gap-6">
        <ReviewContext
          motivation={pairing.motivation}
          review={pairing.latest_review}
          testIdPrefix={`pairing-${pairing.pairing_id}`}
        />
      </CardContent>
      <CardFooter>
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
      </CardFooter>
    </Card>
  );
}
