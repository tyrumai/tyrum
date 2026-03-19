// @vitest-environment jsdom

import * as schemas from "@tyrum/contracts";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { addListenerMock, getLaunchUrlMock, isNativePlatformMock, listeners, scanBarcodeMock } =
  vi.hoisted(() => {
    const listenersInner = new Map<string, (event: unknown) => void>();

    return {
      addListenerMock: vi.fn(async (event: string, listener: (event: unknown) => void) => {
        listenersInner.set(event, listener);
        return {
          remove: vi.fn(async () => {
            listenersInner.delete(event);
          }),
        };
      }),
      getLaunchUrlMock: vi.fn(async () => ({ url: undefined })),
      isNativePlatformMock: vi.fn(() => true),
      listeners: listenersInner,
      scanBarcodeMock: vi.fn(async () => ({ ScanResult: "" })),
    };
  });

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: isNativePlatformMock,
  },
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: addListenerMock,
    getLaunchUrl: getLaunchUrlMock,
  },
}));

vi.mock("@capacitor/barcode-scanner", () => ({
  CapacitorBarcodeScanner: {
    scanBarcode: scanBarcodeMock,
  },
  CapacitorBarcodeScannerTypeHint: {
    QR_CODE: "QR_CODE",
  },
}));

function createTestRoot(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  return { container, root: createRoot(container) };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function flushMicrotasks(count = 4): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

describe("useMobileBootstrapIntents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeners.clear();
    isNativePlatformMock.mockReturnValue(true);
    getLaunchUrlMock.mockResolvedValue({ url: undefined });
    scanBarcodeMock.mockResolvedValue({ ScanResult: "" });
  });

  it("loads bootstrap drafts from launch URLs and allows the same URL again after clearing", async () => {
    const launchUrl = schemas.createMobileBootstrapUrl({
      v: 1,
      httpBaseUrl: "https://gateway.example",
      wsUrl: "wss://gateway.example/ws",
      token: "token-1",
    });
    getLaunchUrlMock.mockResolvedValue({ url: launchUrl });

    const { useMobileBootstrapIntents } = await import("../src/use-mobile-bootstrap-intents.js");
    const { container, root } = createTestRoot();

    let latestState: ReturnType<typeof useMobileBootstrapIntents> | null = null;
    const Probe = () => {
      latestState = useMobileBootstrapIntents();
      return null;
    };

    await act(async () => {
      root.render(React.createElement(Probe));
      await flushMicrotasks();
    });

    expect(latestState?.draftConfig).toMatchObject({
      httpBaseUrl: "https://gateway.example",
      wsUrl: "wss://gateway.example/ws",
      token: "token-1",
    });
    expect(latestState?.noticeMessage).toContain("mobile link");

    act(() => {
      latestState?.clearDraft();
    });
    expect(latestState?.draftConfig).toBeNull();

    await act(async () => {
      listeners.get("appUrlOpen")?.({ url: launchUrl });
      await flushMicrotasks();
    });

    expect(latestState?.draftConfig).toMatchObject({
      httpBaseUrl: "https://gateway.example",
      wsUrl: "wss://gateway.example/ws",
      token: "token-1",
    });

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("loads bootstrap drafts from QR scans", async () => {
    const scannedUrl = schemas.createMobileBootstrapUrl({
      v: 1,
      httpBaseUrl: "http://127.0.0.1:8788",
      wsUrl: "ws://127.0.0.1:8788/ws",
      token: "token-2",
    });
    scanBarcodeMock.mockResolvedValue({ ScanResult: scannedUrl });

    const { useMobileBootstrapIntents } = await import("../src/use-mobile-bootstrap-intents.js");
    const { container, root } = createTestRoot();

    let latestState: ReturnType<typeof useMobileBootstrapIntents> | null = null;
    const Probe = () => {
      latestState = useMobileBootstrapIntents();
      return null;
    };

    await act(async () => {
      root.render(React.createElement(Probe));
      await flushMicrotasks();
    });

    await act(async () => {
      await latestState?.scanQrCode();
      await flushMicrotasks();
    });

    expect(scanBarcodeMock).toHaveBeenCalledTimes(1);
    expect(latestState?.draftConfig).toMatchObject({
      httpBaseUrl: "http://127.0.0.1:8788",
      wsUrl: "ws://127.0.0.1:8788/ws",
      token: "token-2",
    });
    expect(latestState?.noticeMessage).toContain("scanned QR code");

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("clears a previously loaded draft when a scanned bootstrap URL is malformed", async () => {
    const scannedUrl = schemas.createMobileBootstrapUrl({
      v: 1,
      httpBaseUrl: "https://gateway.example",
      wsUrl: "wss://gateway.example/ws",
      token: "token-qr",
    });
    scanBarcodeMock.mockResolvedValueOnce({ ScanResult: scannedUrl });
    scanBarcodeMock.mockResolvedValueOnce({ ScanResult: "tyrum://bootstrap?payload=%%%" });

    const { useMobileBootstrapIntents } = await import("../src/use-mobile-bootstrap-intents.js");
    const { container, root } = createTestRoot();

    let latestState: ReturnType<typeof useMobileBootstrapIntents> | null = null;
    const Probe = () => {
      latestState = useMobileBootstrapIntents();
      return null;
    };

    await act(async () => {
      root.render(React.createElement(Probe));
      await flushMicrotasks();
    });

    await act(async () => {
      await latestState?.scanQrCode();
      await flushMicrotasks();
    });

    expect(latestState?.draftConfig).toMatchObject({
      httpBaseUrl: "https://gateway.example",
      wsUrl: "wss://gateway.example/ws",
      token: "token-qr",
    });
    expect(latestState?.noticeMessage).toContain("scanned QR code");

    await act(async () => {
      await latestState?.scanQrCode();
      await flushMicrotasks();
    });

    expect(latestState?.draftConfig).toBeNull();
    expect(latestState?.noticeMessage).toBeNull();
    expect(latestState?.errorMessage).toMatch(/base64url/i);

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("surfaces bootstrap import errors from malformed deep links", async () => {
    getLaunchUrlMock.mockResolvedValue({ url: "tyrum://bootstrap?payload=%%%" });

    const { useMobileBootstrapIntents } = await import("../src/use-mobile-bootstrap-intents.js");
    const { container, root } = createTestRoot();

    let latestState: ReturnType<typeof useMobileBootstrapIntents> | null = null;
    const Probe = () => {
      latestState = useMobileBootstrapIntents();
      return null;
    };

    await act(async () => {
      root.render(React.createElement(Probe));
      await flushMicrotasks();
    });

    expect(latestState?.draftConfig).toBeNull();
    expect(latestState?.errorMessage).toMatch(/base64url/i);

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("clears prior imports for malformed deep links and allows the same link to load again", async () => {
    const launchUrl = schemas.createMobileBootstrapUrl({
      v: 1,
      httpBaseUrl: "https://gateway.example",
      wsUrl: "wss://gateway.example/ws",
      token: "token-link",
    });
    getLaunchUrlMock.mockResolvedValue({ url: launchUrl });

    const { useMobileBootstrapIntents } = await import("../src/use-mobile-bootstrap-intents.js");
    const { container, root } = createTestRoot();

    let latestState: ReturnType<typeof useMobileBootstrapIntents> | null = null;
    const Probe = () => {
      latestState = useMobileBootstrapIntents();
      return null;
    };

    await act(async () => {
      root.render(React.createElement(Probe));
      await flushMicrotasks();
    });

    expect(latestState?.draftConfig).toMatchObject({
      httpBaseUrl: "https://gateway.example",
      wsUrl: "wss://gateway.example/ws",
      token: "token-link",
    });

    await act(async () => {
      listeners.get("appUrlOpen")?.({ url: "tyrum://bootstrap?payload=%%%" });
      await flushMicrotasks();
    });

    expect(latestState?.draftConfig).toBeNull();
    expect(latestState?.noticeMessage).toBeNull();
    expect(latestState?.errorMessage).toMatch(/base64url/i);

    await act(async () => {
      listeners.get("appUrlOpen")?.({ url: launchUrl });
      await flushMicrotasks();
    });

    expect(latestState?.draftConfig).toMatchObject({
      httpBaseUrl: "https://gateway.example",
      wsUrl: "wss://gateway.example/ws",
      token: "token-link",
    });
    expect(latestState?.noticeMessage).toContain("mobile link");
    expect(latestState?.errorMessage).toBeNull();

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("ignores appUrlOpen events after unmount when listener registration resolves late", async () => {
    const launchUrl = schemas.createMobileBootstrapUrl({
      v: 1,
      httpBaseUrl: "https://gateway.example",
      wsUrl: "wss://gateway.example/ws",
      token: "token-race",
    });
    const parseSpy = vi.spyOn(schemas, "parseMobileBootstrapUrl");
    const listenerDeferred = createDeferred<{ remove: () => Promise<void> }>();
    const removeListener = vi.fn(async () => {
      listeners.delete("appUrlOpen");
    });

    addListenerMock.mockImplementation((event: string, listener: (event: unknown) => void) => {
      listeners.set(event, listener);
      return listenerDeferred.promise;
    });

    const { useMobileBootstrapIntents } = await import("../src/use-mobile-bootstrap-intents.js");
    const { container, root } = createTestRoot();

    const Probe = () => {
      useMobileBootstrapIntents();
      return null;
    };

    await act(async () => {
      root.render(React.createElement(Probe));
      await flushMicrotasks();
    });

    act(() => {
      root.unmount();
    });

    await act(async () => {
      listeners.get("appUrlOpen")?.({ url: launchUrl });
      await flushMicrotasks();
    });

    expect(parseSpy).not.toHaveBeenCalled();

    await act(async () => {
      listenerDeferred.resolve({ remove: removeListener });
      await flushMicrotasks();
    });

    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(listeners.has("appUrlOpen")).toBe(false);

    container.remove();
  });
});
