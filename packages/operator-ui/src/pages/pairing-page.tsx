import type { OperatorCore, Pairing } from "@tyrum/operator-core";
import { Link2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardFooter, CardHeader } from "../components/ui/card.js";
import { Checkbox } from "../components/ui/checkbox.js";
import { EmptyState } from "../components/ui/empty-state.js";
import { Label } from "../components/ui/label.js";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group.js";
import { Textarea } from "../components/ui/textarea.js";
import { useOperatorStore } from "../use-operator-store.js";

type PairingTrustLevel = "local" | "remote";

function resolveErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function useMountedRef() {
  const mountedRef = useRef(true);
  useEffect(() => {
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
  const [selectedCapabilityIds, setSelectedCapabilityIds] = useState<Set<string>>(
    () => new Set(pairing.capability_allowlist.map((capability) => capability.id)),
  );
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);

  const onApprove = async (): Promise<void> => {
    if (busy) return;
    setBusy("approve");
    try {
      const trimmedReason = reasonRef.current?.value.trim() ?? "";
      const capability_allowlist = pairing.capability_allowlist.filter((capability) =>
        selectedCapabilityIds.has(capability.id),
      );
      await core.pairingStore.approve(pairing.pairing_id, {
        trust_level: trustLevel,
        capability_allowlist,
        ...(trimmedReason ? { reason: trimmedReason } : {}),
      });
      toast.success("Pairing approved");
    } catch (error) {
      toast.error(resolveErrorMessage(error));
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
      toast.error(resolveErrorMessage(error));
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="grid gap-1">
          <div className="text-sm font-medium text-fg">Pairing request</div>
          <div className="text-sm text-fg-muted">
            Node <span className="font-medium text-fg">{pairing.node.node_id}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-6">
        <div className="grid gap-3">
          <Label required={true}>Trust level</Label>
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
              />
              <Label htmlFor={`pairing-${pairing.pairing_id}-trust-local`}>Local</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem
                id={`pairing-${pairing.pairing_id}-trust-remote`}
                data-testid={`pairing-trust-level-${pairing.pairing_id}-remote`}
                value="remote"
              />
              <Label htmlFor={`pairing-${pairing.pairing_id}-trust-remote`}>Remote</Label>
            </div>
          </RadioGroup>
        </div>

        <div className="grid gap-3">
          <Label>Capabilities</Label>
          {pairing.capability_allowlist.length === 0 ? (
            <div className="text-sm text-fg-muted">No capabilities requested.</div>
          ) : (
            <div className="grid gap-2">
              {pairing.capability_allowlist.map((capability, index) => {
                const checkboxId = `pairing-${pairing.pairing_id}-cap-${index}`;
                const checked = selectedCapabilityIds.has(capability.id);
                return (
                  <div key={checkboxId} className="flex items-start gap-2">
                    <Checkbox
                      id={checkboxId}
                      data-testid={`pairing-capability-${pairing.pairing_id}-${index}`}
                      checked={checked}
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
                    <Label htmlFor={checkboxId} className="text-sm font-normal text-fg">
                      {capability.id}
                    </Label>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <Textarea
          data-testid={`pairing-reason-${pairing.pairing_id}`}
          label="Reason"
          rows={3}
          ref={reasonRef}
          placeholder="Optional"
        />
      </CardContent>
      <CardFooter className="gap-2">
        <Button
          data-testid={`pairing-approve-${pairing.pairing_id}`}
          isLoading={busy === "approve"}
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
      toast.error(resolveErrorMessage(error));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="grid gap-1">
          <div className="text-sm font-medium text-fg">Trusted device</div>
          <div className="text-sm text-fg-muted">
            Node <span className="font-medium text-fg">{pairing.node.node_id}</span>
          </div>
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
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Pairing</h1>
        <Button
          variant="outline"
          data-testid="pairing-refresh"
          isLoading={pairing.loading}
          onClick={() => {
            void core.pairingStore.refresh();
          }}
        >
          Refresh
        </Button>
      </div>

      <div className="grid gap-4">
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

      {approved.length > 0 ? (
        <div className="grid gap-3">
          <h2 className="text-lg font-medium text-fg">Trusted devices</h2>
          <div className="grid gap-4">
            {approved.map((entry) => (
              <ApprovedPairingCard key={entry.pairing_id} core={core} pairing={entry} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
