import type { Pairing } from "@tyrum/operator-core";
import type { NodeIdentity, NodeInventoryEntry } from "@tyrum/schemas";
import { type ComponentProps, useEffect, useRef } from "react";
import { Badge } from "../ui/badge.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";

export type AttachmentKind = "none" | "lane" | "local";

const PLATFORM_LABELS: Record<string, string> = {
  darwin: "macOS",
  linux: "Linux",
  win32: "Windows",
};

export interface NodeMeta {
  platform: string | null;
  version: string | null;
  mode: string | null;
  ip: string | null;
}

export function extractNodeMeta(metadata: unknown): NodeMeta {
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

export function getPairingStatusDisplay(status: Pairing["status"] | "pending"): {
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

export function ReviewContext({
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

export function NodeDetails({ node, requestedAt }: { node: NodeIdentity; requestedAt?: string }) {
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

export function useMountedRef() {
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

export function ConnectionBadges({
  id,
  inventory,
  attachmentKind,
}: {
  id?: string | number;
  inventory?: NodeInventoryEntry;
  attachmentKind: AttachmentKind;
}) {
  if (!inventory && attachmentKind === "none") return null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      {inventory ? (
        <Badge
          data-testid={id === undefined ? undefined : `pairing-connection-${String(id)}`}
          variant={inventory.connected ? "success" : "outline"}
        >
          {inventory.connected ? "Connected" : "Offline"}
        </Badge>
      ) : null}
      {attachmentKind === "local" ? (
        <Badge
          data-testid={id === undefined ? undefined : `pairing-attached-local-${String(id)}`}
          className="border-primary/25 bg-primary/10 text-primary"
        >
          Attached to this UI
        </Badge>
      ) : null}
      {attachmentKind === "lane" ? (
        <Badge
          data-testid={id === undefined ? undefined : `pairing-attached-lane-${String(id)}`}
          variant="outline"
        >
          Attached to lane
        </Badge>
      ) : null}
    </div>
  );
}

export function NodeInventoryBadges({
  pairingId,
  inventory,
  attachmentKind,
}: {
  pairingId: number;
  inventory?: NodeInventoryEntry;
  attachmentKind: AttachmentKind;
}) {
  return <ConnectionBadges id={pairingId} inventory={inventory} attachmentKind={attachmentKind} />;
}
