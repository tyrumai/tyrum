import {
  isElevatedModeActive,
  type ElevatedModeState,
  type OperatorCore,
} from "@tyrum/operator-app";
import {
  createOperatorAdminClient,
  executeOperatorCommand,
  TyrumHttpClientError,
} from "@tyrum/operator-app/browser";
import { useMemo, type ReactNode } from "react";
import type { DesktopApi } from "../../desktop-api.js";
import { useHostApiOptional } from "../../host/host-api.js";
import { useOperatorStore } from "../../use-operator-store.js";
import { resolveTyrumHttpFetch } from "../../utils/tyrum-http-fetch.js";
import { useElevatedModeUiContext } from "../elevated-mode/elevated-mode-provider.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardFooter } from "../ui/card.js";
import { Alert } from "../ui/alert.js";

export type AdminHttpClient = OperatorCore["admin"];

export function isAdminAccessHttpError(error: unknown): boolean {
  return (
    error instanceof TyrumHttpClientError &&
    error.status === 403 &&
    error.error === "forbidden" &&
    (error.message === "insufficient scope" ||
      error.message === "route is not scope-authorized for scoped tokens")
  );
}

function createElevatedAdminHttpClient(input: {
  core: OperatorCore;
  desktopApi: DesktopApi | null;
  mode: ReturnType<typeof useElevatedModeUiContext>["mode"];
  elevatedStatus: ElevatedModeState["status"];
  elevatedToken: ElevatedModeState["elevatedToken"];
}): AdminHttpClient | null {
  if (input.elevatedStatus !== "active" || !input.elevatedToken) return null;

  return createOperatorAdminClient({
    baseUrl: input.core.httpBaseUrl,
    auth: { type: "bearer", token: input.elevatedToken },
    fetch: resolveTyrumHttpFetch(input.desktopApi, input.mode),
  });
}

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

export function useAdminHttpClient(options: { access: "strict" }): AdminHttpClient | null;
export function useAdminHttpClient(options?: { access?: "read" }): AdminHttpClient;
export function useAdminHttpClient(options?: {
  access?: "read" | "strict";
}): AdminHttpClient | null {
  const { core, mode } = useElevatedModeUiContext();
  const host = useHostApiOptional();
  const desktopApi = host?.kind === "desktop" ? host.api : null;
  const access = options?.access ?? "read";
  const elevatedMode = useOperatorStore(core.elevatedModeStore);
  const elevatedStatus = elevatedMode.status;
  const elevatedToken = elevatedMode.elevatedToken;
  const elevatedHttp = useMemo(
    () =>
      createElevatedAdminHttpClient({
        core,
        desktopApi,
        mode,
        elevatedStatus,
        elevatedToken,
      }),
    [core.httpBaseUrl, desktopApi, elevatedStatus, elevatedToken, mode],
  );

  if (access === "strict") {
    return elevatedHttp;
  }

  return elevatedHttp ?? core.admin;
}

export function useAdminMutationHttpClient(): AdminHttpClient | null {
  const { core, mode } = useElevatedModeUiContext();
  const host = useHostApiOptional();
  const desktopApi = host?.kind === "desktop" ? host.api : null;
  const elevatedMode = useOperatorStore(core.elevatedModeStore);
  const elevatedStatus = elevatedMode.status;
  const elevatedToken = elevatedMode.elevatedToken;

  return useMemo(
    () =>
      createElevatedAdminHttpClient({
        core,
        desktopApi,
        mode,
        elevatedStatus,
        elevatedToken,
      }),
    [core.httpBaseUrl, desktopApi, elevatedStatus, elevatedToken, mode],
  );
}

export function useAdminMutationAccess(core: OperatorCore): {
  canMutate: boolean;
  requestEnter: () => void;
} {
  const { requestEnter } = useElevatedModeUiContext();
  const elevatedMode = useOperatorStore(core.elevatedModeStore);
  return { canMutate: isElevatedModeActive(elevatedMode), requestEnter };
}

export function AdminAccessGateCard({
  title = "Authorize admin access to continue",
  description = "Admin configuration and dangerous operator actions require temporary admin access.",
  onAuthorize,
}: {
  title?: string;
  description?: string;
  onAuthorize: () => void;
}) {
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
            onAuthorize();
          }}
        >
          Authorize admin access
        </Button>
      </CardFooter>
    </Card>
  );
}

export function AdminMutationGate({
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
    <AdminAccessGateCard
      title={title}
      description={description}
      onAuthorize={() => {
        requestEnter();
      }}
    />
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

  return await executeOperatorCommand({
    url: core.wsUrl,
    token,
    command,
  });
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
