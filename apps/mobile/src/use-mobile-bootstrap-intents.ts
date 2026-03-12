import { parseMobileBootstrapUrl } from "@tyrum/schemas";
import { App } from "@capacitor/app";
import {
  CapacitorBarcodeScanner,
  CapacitorBarcodeScannerTypeHint,
} from "@capacitor/barcode-scanner";
import { Capacitor } from "@capacitor/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MobileBootstrapConfig } from "./mobile-config.js";
import { mobileBootstrapConfigFromPayload } from "./mobile-config.js";

type BootstrapSource = "deep-link" | "qr";

function bootstrapNoticeMessage(source: BootstrapSource): string {
  return source === "qr"
    ? "Loaded mobile bootstrap settings from the scanned QR code."
    : "Loaded mobile bootstrap settings from the mobile link.";
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useMobileBootstrapIntents(): {
  canScanQr: boolean;
  draftConfig: MobileBootstrapConfig | null;
  noticeMessage: string | null;
  errorMessage: string | null;
  scanBusy: boolean;
  clearDraft: () => void;
  scanQrCode: () => Promise<void>;
} {
  const [draftConfig, setDraftConfig] = useState<MobileBootstrapConfig | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const lastHandledUrlRef = useRef<string | null>(null);
  const canScanQr = Capacitor.isNativePlatform();

  const clearQueuedBootstrapState = useCallback(() => {
    lastHandledUrlRef.current = null;
    setDraftConfig(null);
    setNoticeMessage(null);
  }, []);

  const handleBootstrapImportError = useCallback(
    (error: unknown) => {
      clearQueuedBootstrapState();
      setErrorMessage(formatUnknownError(error));
    },
    [clearQueuedBootstrapState],
  );

  const queueBootstrapUrl = useCallback((url: string, source: BootstrapSource) => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl || lastHandledUrlRef.current === trimmedUrl) {
      return;
    }

    const payload = parseMobileBootstrapUrl(trimmedUrl);
    lastHandledUrlRef.current = trimmedUrl;
    setDraftConfig(mobileBootstrapConfigFromPayload(payload));
    setNoticeMessage(bootstrapNoticeMessage(source));
    setErrorMessage(null);
  }, []);

  const clearDraft = useCallback(() => {
    clearQueuedBootstrapState();
    setErrorMessage(null);
  }, [clearQueuedBootstrapState]);

  const scanQrCode = useCallback(async () => {
    if (!canScanQr) {
      setErrorMessage("QR scanning is only available on native mobile builds.");
      return;
    }

    setScanBusy(true);
    try {
      const result = await CapacitorBarcodeScanner.scanBarcode({
        hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
        scanInstructions: "Scan the Tyrum Mobile bootstrap QR code.",
        scanButton: false,
      });
      try {
        queueBootstrapUrl(result.ScanResult, "qr");
      } catch (error) {
        handleBootstrapImportError(error);
      }
    } catch (error) {
      setErrorMessage(formatUnknownError(error));
    } finally {
      setScanBusy(false);
    }
  }, [canScanQr, handleBootstrapImportError, queueBootstrapUrl]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    let disposed = false;
    const removeListeners: Array<() => void> = [];

    void App.getLaunchUrl()
      .then((result) => {
        if (disposed || !result?.url) return;
        try {
          queueBootstrapUrl(result.url, "deep-link");
        } catch (error) {
          handleBootstrapImportError(error);
        }
      })
      .catch((error) => {
        if (!disposed) {
          setErrorMessage(formatUnknownError(error));
        }
      });

    void App.addListener("appUrlOpen", (event) => {
      try {
        queueBootstrapUrl(event.url, "deep-link");
      } catch (error) {
        handleBootstrapImportError(error);
      }
    }).then((listener) => {
      if (disposed) {
        void listener.remove();
        return;
      }
      removeListeners.push(() => {
        void listener.remove();
      });
    });

    return () => {
      disposed = true;
      for (const removeListener of removeListeners) {
        removeListener();
      }
    };
  }, [handleBootstrapImportError, queueBootstrapUrl]);

  return {
    canScanQr,
    draftConfig,
    noticeMessage,
    errorMessage,
    scanBusy,
    clearDraft,
    scanQrCode,
  };
}
