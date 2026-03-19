import type { PairingGetResponse } from "@tyrum/operator-core/browser";
import {
  ElevatedModeRequiredError,
  isElevatedModeActive,
  type Pairing,
} from "@tyrum/operator-core";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useBrowserNodeOptional } from "./browser-node/browser-node-provider.js";
import { useElevatedModeUiContext } from "./components/elevated-mode/elevated-mode-provider.js";
import { useHostApiOptional } from "./host/host-api.js";
import { useOperatorStore } from "./use-operator-store.js";

const AUTO_APPROVE_REASON = "auto-approved local app node";

type LocalNodeStatus = "disabled" | "disconnected" | "connecting" | "connected" | "error";

type LocalNodeSnapshot = {
  enabled: boolean;
  status: LocalNodeStatus;
  deviceId: string | null;
};

type AutoApprovalAttemptState = "in_flight" | "approved" | "blocked" | "failed";

type AutoApprovalAttempt = {
  state: AutoApprovalAttemptState;
  summaryVersion: string;
};

const NO_LOCAL_NODE: LocalNodeSnapshot = {
  enabled: false,
  status: "disabled",
  deviceId: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isAutoApprovablePairingStatus(status: Pairing["status"]): boolean {
  return status === "queued" || status === "awaiting_human";
}

function buildPairingKey(input: Pick<Pairing, "pairing_id" | "requested_at">): string {
  return `${String(input.pairing_id)}:${input.requested_at}`;
}

function isLocalNodeEligible(snapshot: LocalNodeSnapshot): boolean {
  return (
    snapshot.enabled &&
    snapshot.deviceId !== null &&
    (snapshot.status === "connected" || snapshot.status === "connecting")
  );
}

function isLocalPairingCandidate(pairing: Pairing, localNode: LocalNodeSnapshot): boolean {
  return (
    isLocalNodeEligible(localNode) &&
    pairing.node.node_id === localNode.deviceId &&
    isAutoApprovablePairingStatus(pairing.status)
  );
}

function buildPairingSummaryVersion(input: Pick<Pairing, "status" | "latest_review">): string {
  const latestReview = input.latest_review;
  return [
    input.status,
    latestReview?.review_id ?? "",
    latestReview?.state ?? "",
    latestReview?.created_at ?? "",
    latestReview?.started_at ?? "",
    latestReview?.completed_at ?? "",
  ].join("|");
}

function parseDesktopNodeSnapshot(value: unknown): LocalNodeSnapshot | null {
  if (!isRecord(value)) return null;
  const node = isRecord(value["node"]) ? value["node"] : null;
  if (!node) return null;

  const rawStatus = readTrimmedString(value["nodeStatus"]);
  const connected = node["connected"] === true;
  const status: LocalNodeStatus = connected
    ? "connected"
    : rawStatus === "connecting"
      ? "connecting"
      : rawStatus === "error"
        ? "error"
        : "disconnected";

  return {
    enabled: true,
    status,
    deviceId: readTrimmedString(node["deviceId"]),
  };
}

export function extractLatestTerminalReviewState(
  pairing: PairingGetResponse["pairing"],
): "approved" | "denied" | "revoked" | null {
  const reviews = pairing.reviews ?? (pairing.latest_review ? [pairing.latest_review] : []);
  let latest:
    | {
        index: number;
        state: "approved" | "denied" | "revoked";
        sortValue: number;
      }
    | undefined;

  for (const [index, review] of reviews.entries()) {
    if (review.state !== "approved" && review.state !== "denied" && review.state !== "revoked") {
      continue;
    }

    const sortValueRaw = Date.parse(review.completed_at ?? review.started_at ?? review.created_at);
    const sortValue = Number.isFinite(sortValueRaw) ? sortValueRaw : -1;
    if (
      latest === undefined ||
      sortValue > latest.sortValue ||
      (sortValue === latest.sortValue && index > latest.index)
    ) {
      latest = { index, state: review.state, sortValue };
    }
  }

  return latest?.state ?? null;
}

export function isBenignAutoApprovalRace(
  core: { pairingStore: { getSnapshot(): { byId: Record<number, Pairing> } } },
  pairingId: number,
  pairingKey: string,
): boolean {
  const current = core.pairingStore.getSnapshot().byId[pairingId];
  if (!current) return true;
  if (buildPairingKey(current) !== pairingKey) return true;
  return !isAutoApprovablePairingStatus(current.status);
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function useDesktopLocalNodeSnapshot(): LocalNodeSnapshot {
  const host = useHostApiOptional();
  const desktopApi = host?.kind === "desktop" ? host.api : null;
  const [snapshot, setSnapshot] = useState<LocalNodeSnapshot>(NO_LOCAL_NODE);

  useEffect(() => {
    if (!desktopApi?.node.getStatus) {
      setSnapshot(NO_LOCAL_NODE);
      return;
    }

    let disposed = false;

    void desktopApi.node
      .getStatus()
      .then((status) => {
        if (disposed) return;
        setSnapshot({
          enabled: true,
          status: status.connected ? "connected" : "disconnected",
          deviceId: readTrimmedString(status.deviceId),
        });
      })
      .catch(() => {
        if (!disposed) {
          setSnapshot(NO_LOCAL_NODE);
        }
      });

    const unsubscribe = desktopApi.onStatusChange((event) => {
      if (disposed) return;
      const next = parseDesktopNodeSnapshot(event);
      if (next) {
        setSnapshot(next);
      }
    });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [desktopApi]);

  return snapshot;
}

function useMobileLocalNodeSnapshot(): LocalNodeSnapshot {
  const host = useHostApiOptional();
  const mobileApi = host?.kind === "mobile" ? host.api : null;
  const [snapshot, setSnapshot] = useState<LocalNodeSnapshot>(NO_LOCAL_NODE);

  useEffect(() => {
    if (!mobileApi) {
      setSnapshot(NO_LOCAL_NODE);
      return;
    }

    let disposed = false;

    void mobileApi.node
      .getState()
      .then((state) => {
        if (disposed) return;
        setSnapshot({
          enabled: state.enabled,
          status: state.status,
          deviceId: readTrimmedString(state.deviceId),
        });
      })
      .catch(() => {
        if (!disposed) {
          setSnapshot(NO_LOCAL_NODE);
        }
      });

    const unsubscribe = mobileApi.onStateChange?.((state) => {
      if (disposed) return;
      setSnapshot({
        enabled: state.enabled,
        status: state.status,
        deviceId: readTrimmedString(state.deviceId),
      });
    });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [mobileApi]);

  return snapshot;
}

function useBrowserLocalNodeSnapshot(): LocalNodeSnapshot {
  const browserNode = useBrowserNodeOptional();

  return useMemo(() => {
    if (!browserNode) return NO_LOCAL_NODE;
    return {
      enabled: browserNode.enabled,
      status: browserNode.status,
      deviceId: readTrimmedString(browserNode.deviceId),
    };
  }, [browserNode]);
}

function useLocalNodeSnapshot(): LocalNodeSnapshot {
  const host = useHostApiOptional();
  const desktopSnapshot = useDesktopLocalNodeSnapshot();
  const mobileSnapshot = useMobileLocalNodeSnapshot();
  const browserSnapshot = useBrowserLocalNodeSnapshot();

  switch (host?.kind) {
    case "desktop":
      return desktopSnapshot;
    case "mobile":
      return mobileSnapshot;
    case "web":
      return browserSnapshot;
    default:
      return NO_LOCAL_NODE;
  }
}

export function LocalNodeAutoApprovalBridge(): null {
  const { core, enterElevatedMode } = useElevatedModeUiContext();
  const localNode = useLocalNodeSnapshot();
  const pairing = useOperatorStore(core.pairingStore);
  const elevatedMode = useOperatorStore(core.elevatedModeStore);
  const elevatedModeRef = useRef(elevatedMode);
  const localNodeRef = useRef(localNode);
  const attemptsRef = useRef(new Map<string, AutoApprovalAttempt>());

  elevatedModeRef.current = elevatedMode;
  localNodeRef.current = localNode;

  const candidates = useMemo(
    () =>
      Object.values(pairing.byId).filter((entry) => {
        return isLocalPairingCandidate(entry, localNode);
      }),
    [localNode, pairing.byId],
  );

  useEffect(() => {
    for (const candidate of candidates) {
      const pairingKey = buildPairingKey(candidate);
      const summaryVersion = buildPairingSummaryVersion(candidate);
      const previousAttempt = attemptsRef.current.get(pairingKey);
      if (
        previousAttempt?.state === "blocked" &&
        previousAttempt.summaryVersion !== summaryVersion
      ) {
        attemptsRef.current.delete(pairingKey);
      }
    }
  }, [candidates]);

  useEffect(() => {
    if (!isLocalNodeEligible(localNode)) return;

    for (const candidate of candidates) {
      const pairingKey = buildPairingKey(candidate);
      const summaryVersion = buildPairingSummaryVersion(candidate);
      if (attemptsRef.current.has(pairingKey)) {
        continue;
      }
      attemptsRef.current.set(pairingKey, { state: "in_flight", summaryVersion });

      void (async () => {
        try {
          const detailed = await core.http.pairings.get(candidate.pairing_id);
          const current = detailed.pairing;
          if (buildPairingKey(current) !== pairingKey) {
            attemptsRef.current.delete(pairingKey);
            return;
          }
          if (!isAutoApprovablePairingStatus(current.status)) {
            attemptsRef.current.delete(pairingKey);
            return;
          }

          const activeLocalNode = localNodeRef.current;
          if (
            !isLocalNodeEligible(activeLocalNode) ||
            current.node.node_id !== activeLocalNode.deviceId
          ) {
            attemptsRef.current.delete(pairingKey);
            return;
          }

          const latestTerminalReviewState = extractLatestTerminalReviewState(current);
          if (latestTerminalReviewState === "denied" || latestTerminalReviewState === "revoked") {
            attemptsRef.current.set(pairingKey, {
              state: "blocked",
              summaryVersion: buildPairingSummaryVersion(current),
            });
            return;
          }

          if (!isElevatedModeActive(elevatedModeRef.current)) {
            await enterElevatedMode();
          }

          const approveInput = {
            trust_level: "local" as const,
            capability_allowlist: current.node.capabilities,
            reason: AUTO_APPROVE_REASON,
          };

          try {
            await core.pairingStore.approve(current.pairing_id, approveInput);
          } catch (error) {
            if (!(error instanceof ElevatedModeRequiredError)) {
              throw error;
            }
            await enterElevatedMode();
            await core.pairingStore.approve(current.pairing_id, approveInput);
          }

          attemptsRef.current.set(pairingKey, {
            state: "approved",
            summaryVersion: buildPairingSummaryVersion(current),
          });
        } catch (error) {
          if (isBenignAutoApprovalRace(core, candidate.pairing_id, pairingKey)) {
            attemptsRef.current.delete(pairingKey);
            return;
          }
          attemptsRef.current.set(pairingKey, {
            state: "failed",
            summaryVersion,
          });
          toast.warning(`Local node auto-approval failed: ${formatErrorMessage(error)}`);
        }
      })();
    }
  }, [candidates, core, enterElevatedMode, localNode]);

  return null;
}
