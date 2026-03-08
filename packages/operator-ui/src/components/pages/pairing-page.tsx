import type { OperatorCore, Pairing } from "@tyrum/operator-core";
import type { NodeIdentity } from "@tyrum/schemas";
import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  descriptorIdForClientCapability,
} from "@tyrum/schemas";
import { Link2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppPage } from "../layout/app-page.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardFooter, CardHeader } from "../ui/card.js";
import { Checkbox } from "../ui/checkbox.js";
import { EmptyState } from "../ui/empty-state.js";
import { Label } from "../ui/label.js";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group.js";
import { Textarea } from "../ui/textarea.js";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";
import { extractTakeoverUrlFromNodeIdentity } from "../../utils/takeover-url.js";
import { useOperatorStore } from "../../use-operator-store.js";

type PairingTrustLevel = "local" | "remote";

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
  const m = metadata as Record<string, unknown>;
  const str = (key: string) => (typeof m[key] === "string" && m[key] ? (m[key] as string) : null);
  return {
    platform: str("platform"),
    version: str("version"),
    mode: str("mode"),
    ip: str("ip"),
  };
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
      {details.map((d) => (
        <span key={d.label}>
          {d.label} <span className="font-medium text-fg">{d.value}</span>
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

function PendingPairingCard({ core, pairing }: { core: OperatorCore; pairing: Pairing }) {
  const mountedRef = useMountedRef();

  const initialTrustLevel = (pairing.trust_level ?? "local") satisfies PairingTrustLevel;
  const [trustLevel, setTrustLevel] = useState<PairingTrustLevel>(initialTrustLevel);
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);

  const capabilityOptions = useMemo(() => {
    if (pairing.capability_allowlist.length > 0) {
      return pairing.capability_allowlist;
    }

    return pairing.node.capabilities.map((capability) => ({
      id: descriptorIdForClientCapability(capability),
      version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
    }));
  }, [pairing.capability_allowlist, pairing.node.capabilities]);

  const [selectedCapabilityIds, setSelectedCapabilityIds] = useState<Set<string>>(
    () => new Set(capabilityOptions.map((capability) => capability.id)),
  );
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);
  const isBusy = busy !== null;
  const takeoverUrl = extractTakeoverUrlFromNodeIdentity(pairing.node);

  const onApprove = async (): Promise<void> => {
    if (busy) return;
    setBusy("approve");
    try {
      const trimmedReason = reasonRef.current?.value.trim() ?? "";
      const capability_allowlist = capabilityOptions.filter((capability) =>
        selectedCapabilityIds.has(capability.id),
      );
      await core.pairingStore.approve(pairing.pairing_id, {
        trust_level: trustLevel,
        capability_allowlist,
        ...(trimmedReason ? { reason: trimmedReason } : {}),
      });
      toast.success("Pairing approved");
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
      toast.success("Pairing denied");
    } catch (error) {
      toast.error(formatErrorMessage(error));
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2.5">
        <div className="grid gap-1">
          <div className="text-sm font-medium text-fg">Pairing request</div>
          <div className="text-sm text-fg-muted">
            Node <span className="break-all font-medium text-fg">{pairing.node.node_id}</span>
          </div>
          {pairing.node.label ? (
            <div className="text-xs text-fg-muted">{pairing.node.label}</div>
          ) : null}
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
              {capabilityOptions.map((capability, index) => {
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
      </CardContent>
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
    </Card>
  );
}

function ApprovedPairingCard({ core, pairing }: { core: OperatorCore; pairing: Pairing }) {
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
    <Card>
      <CardHeader className="pb-2.5">
        <div className="grid gap-1">
          <div className="text-sm font-medium text-fg">Trusted device</div>
          <div className="text-sm text-fg-muted">
            Node <span className="break-all font-medium text-fg">{pairing.node.node_id}</span>
          </div>
          {pairing.node.label ? (
            <div className="text-xs text-fg-muted">{pairing.node.label}</div>
          ) : null}
          <NodeDetails node={pairing.node} />
          {pairing.trust_level ? (
            <div className="text-sm text-fg-muted">
              Trust level <span className="font-medium text-fg">{pairing.trust_level}</span>
            </div>
          ) : null}
        </div>
      </CardHeader>
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

export function PairingPage({ core }: { core: OperatorCore }) {
  const pairing = useOperatorStore(core.pairingStore);

  const pending = useMemo(
    () =>
      pairing.pendingIds
        .map((pairingId) => pairing.byId[pairingId])
        .filter((entry): entry is Pairing => entry !== undefined),
    [pairing.byId, pairing.pendingIds],
  );

  const approved = useMemo(
    () => Object.values(pairing.byId).filter((entry) => entry.status === "approved"),
    [pairing.byId],
  );

  return (
    <AppPage title="Pairings" contentClassName="max-w-5xl gap-5">
      <div className="grid gap-3">
        <h2 className="text-lg font-medium text-fg">Pairing requests</h2>
        {pending.length === 0 ? (
          <Card>
            <EmptyState
              data-testid="pairing-empty-state"
              icon={Link2}
              title="No pairing requests"
              description="Pairing requests appear when devices want to connect."
            />
          </Card>
        ) : (
          <div className="grid gap-4">
            {pending.map((entry) => (
              <PendingPairingCard key={entry.pairing_id} core={core} pairing={entry} />
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-3">
        <h2 className="text-lg font-medium text-fg">Existing pairings</h2>
        {approved.length === 0 ? (
          <Card>
            <EmptyState
              data-testid="pairing-approved-empty-state"
              icon={Link2}
              title="No existing pairings"
              description="Approved pairings appear here after you trust a device."
            />
          </Card>
        ) : (
          <div className="grid gap-4">
            {approved.map((entry) => (
              <ApprovedPairingCard key={entry.pairing_id} core={core} pairing={entry} />
            ))}
          </div>
        )}
      </div>
    </AppPage>
  );
}
