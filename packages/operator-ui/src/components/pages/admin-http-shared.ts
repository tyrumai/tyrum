import { isAdminModeActive, type OperatorCore } from "@tyrum/operator-core";
import { createTyrumHttpClient } from "@tyrum/client";
import { useMemo } from "react";
import { useOperatorStore } from "../../use-operator-store.js";
import { resolveTyrumHttpFetch } from "../../utils/tyrum-http-fetch.js";
import { useAdminModeUiContext } from "../admin-mode/admin-mode-provider.js";

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
  const { core, mode } = useAdminModeUiContext();
  const adminMode = useOperatorStore(core.adminModeStore);

  return useMemo(() => {
    if (adminMode.status !== "active" || !adminMode.elevatedToken) return null;

    return createTyrumHttpClient({
      baseUrl: core.httpBaseUrl,
      auth: { type: "bearer", token: adminMode.elevatedToken },
      fetch: resolveTyrumHttpFetch(mode),
    });
  }, [adminMode.elevatedToken, adminMode.status, core.httpBaseUrl, mode]);
}

export function useAdminMutationAccess(core: OperatorCore): {
  canMutate: boolean;
  requestEnter: () => void;
} {
  const { requestEnter } = useAdminModeUiContext();
  const adminMode = useOperatorStore(core.adminModeStore);
  return { canMutate: isAdminModeActive(adminMode), requestEnter };
}
