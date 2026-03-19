import { TyrumHttpClientError } from "@tyrum/operator-core/browser";
import { useRef, useState } from "react";
import { DEFAULT_IMAGE_REF } from "./desktop-environments-page.shared.js";
import { isAdminAccessHttpError, type AdminHttpClient } from "./admin-http-shared.js";
import { useApiAction } from "../../hooks/use-api-action.js";

export type RefreshResult = "admin-access-required" | "error" | "ok" | "stale" | "unsupported";

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return String(error);
}

function isNotFoundHttpError(error: unknown): error is TyrumHttpClientError {
  return error instanceof TyrumHttpClientError && error.status === 404;
}

export function useDesktopEnvironmentRuntimeDefaults(params: {
  isCurrentHttpClient: (httpClient: AdminHttpClient) => boolean;
  syncCreateImageRefToDefault: (nextDefaultImageRef: string) => void;
}) {
  const [runtimeDefaultImageRef, setRuntimeDefaultImageRef] = useState(DEFAULT_IMAGE_REF);
  const [runtimeDefaultImageDraft, setRuntimeDefaultImageDraft] = useState(DEFAULT_IMAGE_REF);
  const [runtimeDefaultReasonDraft, setRuntimeDefaultReasonDraft] = useState("");
  const [runtimeDefaultsLoading, setRuntimeDefaultsLoading] = useState(false);
  const [runtimeDefaultsError, setRuntimeDefaultsError] = useState<string | null>(null);
  const [runtimeDefaultsSupported, setRuntimeDefaultsSupported] = useState(true);
  const runtimeDefaultsMutation = useApiAction<unknown>();
  const loadedDefaultImageRef = useRef(DEFAULT_IMAGE_REF);

  function syncCreateImageRef(nextDefaultImageRef: string): void {
    if (loadedDefaultImageRef.current === nextDefaultImageRef) return;
    loadedDefaultImageRef.current = nextDefaultImageRef;
    params.syncCreateImageRefToDefault(nextDefaultImageRef);
  }

  function reset(): void {
    setRuntimeDefaultsLoading(false);
    setRuntimeDefaultsError(null);
    setRuntimeDefaultsSupported(true);
    setRuntimeDefaultImageRef(DEFAULT_IMAGE_REF);
    setRuntimeDefaultImageDraft(DEFAULT_IMAGE_REF);
    setRuntimeDefaultReasonDraft("");
    loadedDefaultImageRef.current = DEFAULT_IMAGE_REF;
  }

  async function refresh(httpClient: AdminHttpClient): Promise<RefreshResult> {
    setRuntimeDefaultsLoading(true);
    setRuntimeDefaultsError(null);
    try {
      const result = await httpClient.desktopEnvironments.getDefaults();
      if (!params.isCurrentHttpClient(httpClient)) return "stale";
      setRuntimeDefaultsSupported(true);
      setRuntimeDefaultImageRef(result.default_image_ref);
      setRuntimeDefaultImageDraft(result.default_image_ref);
      setRuntimeDefaultReasonDraft("");
      syncCreateImageRef(result.default_image_ref);
      return "ok";
    } catch (error) {
      if (!params.isCurrentHttpClient(httpClient)) return "stale";
      if (isAdminAccessHttpError(error)) {
        setRuntimeDefaultsError(null);
        return "admin-access-required";
      }
      if (isNotFoundHttpError(error)) {
        setRuntimeDefaultsSupported(false);
        setRuntimeDefaultsError(null);
        setRuntimeDefaultImageRef(DEFAULT_IMAGE_REF);
        setRuntimeDefaultImageDraft(DEFAULT_IMAGE_REF);
        setRuntimeDefaultReasonDraft("");
        syncCreateImageRef(DEFAULT_IMAGE_REF);
        return "unsupported";
      }
      setRuntimeDefaultsError(toErrorMessage(error));
      return "error";
    } finally {
      if (params.isCurrentHttpClient(httpClient)) {
        setRuntimeDefaultsLoading(false);
      }
    }
  }

  async function save(httpClient: AdminHttpClient): Promise<void> {
    await runtimeDefaultsMutation.runAndThrow(async () => {
      const saved = await httpClient.desktopEnvironments.updateDefaults({
        default_image_ref: runtimeDefaultImageDraft.trim(),
        reason: runtimeDefaultReasonDraft.trim() || undefined,
      });
      setRuntimeDefaultsSupported(true);
      setRuntimeDefaultsError(null);
      setRuntimeDefaultImageRef(saved.default_image_ref);
      setRuntimeDefaultImageDraft(saved.default_image_ref);
      setRuntimeDefaultReasonDraft("");
      syncCreateImageRef(saved.default_image_ref);
      return saved;
    });
  }

  return {
    runtimeDefaultImageRef,
    runtimeDefaultImageDraft,
    runtimeDefaultReasonDraft,
    runtimeDefaultsLoading,
    runtimeDefaultsError,
    runtimeDefaultsSupported,
    runtimeDefaultsMutation,
    setRuntimeDefaultImageDraft,
    setRuntimeDefaultReasonDraft,
    refresh,
    reset,
    save,
  };
}
