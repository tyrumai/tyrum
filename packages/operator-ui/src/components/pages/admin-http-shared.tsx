import { isElevatedModeActive, type OperatorCore } from "@tyrum/operator-core";
import { TyrumClient, createTyrumHttpClient } from "@tyrum/client/browser";
import { useMemo, type ReactNode } from "react";
import { useOperatorStore } from "../../use-operator-store.js";
import { resolveTyrumHttpFetch } from "../../utils/tyrum-http-fetch.js";
import { useElevatedModeUiContext } from "../elevated-mode/elevated-mode-provider.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardFooter } from "../ui/card.js";
import { Alert } from "../ui/alert.js";

export type AdminHttpClient = ReturnType<typeof createTyrumHttpClient>;

export function toSafeJsonDownloadFileName(rawName: string, fallback: string): string {
  const trimmed = rawName.trim();
  const normalizedBase = trimmed
    .replaceAll(/[/\\]/g, "_")
    .replaceAll(/[^a-zA-Z0-9._-]/g, "_")
    .replaceAll(/_+/g, "_")
    .replaceAll(/^_+|_+$/g, "")
    .slice(0, 128);

  const base = normalizedBase || fallback.replace(/\.json$/i, "");
  return base.toLowerCase().endsWith(".json") ? base : `${base}.json`;
}

export function useAdminHttpClient(): AdminHttpClient | null {
  const { core, mode } = useElevatedModeUiContext();
  const elevatedMode = useOperatorStore(core.elevatedModeStore);

  return useMemo(() => {
    if (elevatedMode.status !== "active" || !elevatedMode.elevatedToken) return null;

    return createTyrumHttpClient({
      baseUrl: core.httpBaseUrl,
      auth: { type: "bearer", token: elevatedMode.elevatedToken },
      fetch: resolveTyrumHttpFetch(mode),
    });
  }, [elevatedMode.elevatedToken, elevatedMode.status, core.httpBaseUrl, mode]);
}

export function useAdminMutationAccess(core: OperatorCore): {
  canMutate: boolean;
  requestEnter: () => void;
} {
  const { requestEnter } = useElevatedModeUiContext();
  const elevatedMode = useOperatorStore(core.elevatedModeStore);
  return { canMutate: isElevatedModeActive(elevatedMode), requestEnter };
}

export function AdminAccessGate({
  core,
  title = "Authorize admin access to continue",
  description = "Admin configuration and dangerous operator actions require temporary admin access.",
  children,
}: {
  core: OperatorCore;
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  const { canMutate, requestEnter } = useAdminMutationAccess(core);

  if (canMutate) {
    return <>{children}</>;
  }

  return (
    <Card data-testid="admin-access-gate">
      <CardContent className="grid gap-4 pt-6">
        <Alert variant="warning" title={title} description={description} />
      </CardContent>
      <CardFooter>
        <Button
          type="button"
          data-testid="admin-access-enter"
          onClick={() => {
            requestEnter();
          }}
        >
          Authorize admin access
        </Button>
      </CardFooter>
    </Card>
  );
}

export async function executeAdminWsCommand({
  core,
  command,
}: {
  core: OperatorCore;
  command: string;
}) {
  const elevatedMode = core.elevatedModeStore.getSnapshot();
  const token = elevatedMode.elevatedToken?.trim();
  if (!isElevatedModeActive(elevatedMode) || !token) {
    throw new Error("Authorize admin access to run commands.");
  }

  const ws = new TyrumClient({
    url: core.wsUrl,
    token,
    capabilities: [],
    reconnect: false,
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const onConnected = () => {
        ws.off("connected", onConnected);
        ws.off("disconnected", onDisconnected);
        ws.off("transport_error", onTransportError);
        resolve();
      };
      const onDisconnected = () => {
        ws.off("connected", onConnected);
        ws.off("disconnected", onDisconnected);
        ws.off("transport_error", onTransportError);
        reject(new Error("Admin command connection closed before it became ready."));
      };
      const onTransportError = (event: { message: string }) => {
        ws.off("connected", onConnected);
        ws.off("disconnected", onDisconnected);
        ws.off("transport_error", onTransportError);
        reject(new Error(event.message));
      };

      ws.on("connected", onConnected);
      ws.on("disconnected", onDisconnected);
      ws.on("transport_error", onTransportError);
      ws.connect();
    });

    return await ws.commandExecute(command);
  } finally {
    ws.disconnect();
  }
}

export function buildReplacementAssignments(
  requiredExecutionProfileIds: readonly string[],
  selections: Record<string, string | null>,
): Record<string, string | null> | undefined {
  if (requiredExecutionProfileIds.length === 0) return undefined;
  return Object.fromEntries(
    requiredExecutionProfileIds.map((profileId) => [profileId, selections[profileId] ?? null]),
  );
}
