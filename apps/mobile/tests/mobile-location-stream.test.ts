// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { clearWatchMock, emit, isNativePlatformMock, requestPermissionsMock, watchPositionMock } =
  vi.hoisted(() => {
    let callback:
      | ((
          position: { coords: Record<string, number | null>; timestamp: number } | null,
          error?: unknown,
        ) => void)
      | null = null;

    return {
      clearWatchMock: vi.fn(async () => {}),
      emit(
        position: { coords: Record<string, number | null>; timestamp: number } | null,
        error?: unknown,
      ) {
        callback?.(position, error);
      },
      isNativePlatformMock: vi.fn(() => true),
      requestPermissionsMock: vi.fn(async () => ({ location: "granted" })),
      watchPositionMock: vi.fn(async (_options, nextCallback) => {
        callback = nextCallback;
        return "watch-1";
      }),
    };
  });

vi.mock(
  "@capacitor/core",
  () => ({
    Capacitor: {
      isNativePlatform: isNativePlatformMock,
    },
  }),
  { virtual: true },
);

vi.mock(
  "@capacitor/geolocation",
  () => ({
    Geolocation: {
      requestPermissions: requestPermissionsMock,
      watchPosition: watchPositionMock,
      clearWatch: clearWatchMock,
    },
  }),
  { virtual: true },
);

async function flushMicrotasks(count = 4) {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

function createDeferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  let reject: (reason?: unknown) => void = () => {};
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function buildPosition(latitude: number, longitude: number, timestamp: string, accuracy = 10) {
  return {
    coords: {
      latitude,
      longitude,
      accuracy,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    },
    timestamp: Date.parse(timestamp),
  };
}

describe("createMobileLocationBeaconStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isNativePlatformMock.mockReturnValue(true);
  });

  afterEach(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
  });

  it("sends the first fix, throttles nearby fixes, and allows distance or time based beacons", async () => {
    const locationBeacon = vi.fn(async () => ({ sample: {}, events: [] }));
    const { createMobileLocationBeaconStream } = await import("../src/mobile-location-stream.js");
    const stream = createMobileLocationBeaconStream({
      client: { locationBeacon } as never,
    });

    await stream.start({
      streamEnabled: true,
      distanceFilterM: 100,
      maxIntervalMs: 900_000,
      maxAccuracyM: 100,
      backgroundEnabled: true,
    });

    emit(buildPosition(52.3676, 4.9041, "2026-03-11T12:00:00Z"));
    await flushMicrotasks();
    expect(locationBeacon).toHaveBeenCalledTimes(1);

    emit(buildPosition(52.36765, 4.90415, "2026-03-11T12:02:00Z"));
    await flushMicrotasks();
    expect(locationBeacon).toHaveBeenCalledTimes(1);

    emit(buildPosition(52.369, 4.91, "2026-03-11T12:03:00Z"));
    await flushMicrotasks();
    expect(locationBeacon).toHaveBeenCalledTimes(2);

    emit(buildPosition(52.3691, 4.9101, "2026-03-11T12:20:00Z", 250));
    await flushMicrotasks();
    expect(locationBeacon).toHaveBeenCalledTimes(2);

    emit(buildPosition(52.3691, 4.9101, "2026-03-11T12:21:00Z", 20));
    await flushMicrotasks();
    expect(locationBeacon).toHaveBeenCalledTimes(3);
  });

  it("clears the active watch when stopped", async () => {
    const { createMobileLocationBeaconStream } = await import("../src/mobile-location-stream.js");
    const stream = createMobileLocationBeaconStream({
      client: { locationBeacon: vi.fn(async () => ({ sample: {}, events: [] })) } as never,
    });

    await stream.start({
      streamEnabled: true,
      distanceFilterM: 100,
      maxIntervalMs: 900_000,
      maxAccuracyM: 100,
      backgroundEnabled: true,
    });
    await stream.stop();

    expect(clearWatchMock).toHaveBeenCalledWith({ id: "watch-1" });
  });

  it("does not queue duplicate nearby beacons while the previous beacon is still in flight", async () => {
    let resolveBeacon: (() => void) | null = null;
    const locationBeacon = vi
      .fn<() => Promise<{ sample: object; events: never[] }>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveBeacon = () => resolve({ sample: {}, events: [] });
          }),
      )
      .mockResolvedValue({ sample: {}, events: [] });
    const { createMobileLocationBeaconStream } = await import("../src/mobile-location-stream.js");
    const stream = createMobileLocationBeaconStream({
      client: { locationBeacon } as never,
    });

    await stream.start({
      streamEnabled: true,
      distanceFilterM: 100,
      maxIntervalMs: 900_000,
      maxAccuracyM: 100,
      backgroundEnabled: true,
    });

    emit(buildPosition(52.3676, 4.9041, "2026-03-11T12:00:00Z"));
    await flushMicrotasks();
    expect(locationBeacon).toHaveBeenCalledTimes(1);

    emit(buildPosition(52.36761, 4.90411, "2026-03-11T12:00:05Z"));
    await flushMicrotasks();
    expect(locationBeacon).toHaveBeenCalledTimes(1);

    resolveBeacon?.();
    await flushMicrotasks();
    expect(locationBeacon).toHaveBeenCalledTimes(1);
  });

  it("preserves the recorded background state for queued beacons", async () => {
    let resolveFirstBeacon: (() => void) | null = null;
    const locationBeacon = vi
      .fn<() => Promise<{ sample: object; events: never[] }>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstBeacon = () => resolve({ sample: {}, events: [] });
          }),
      )
      .mockResolvedValue({ sample: {}, events: [] });
    const { createMobileLocationBeaconStream } = await import("../src/mobile-location-stream.js");
    const stream = createMobileLocationBeaconStream({
      client: { locationBeacon } as never,
    });

    await stream.start({
      streamEnabled: true,
      distanceFilterM: 10,
      maxIntervalMs: 900_000,
      maxAccuracyM: 100,
      backgroundEnabled: true,
    });

    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    emit(buildPosition(52.3676, 4.9041, "2026-03-11T12:00:00Z"));
    await flushMicrotasks();

    emit(buildPosition(52.369, 4.91, "2026-03-11T12:01:00Z"));
    await flushMicrotasks();
    expect(locationBeacon).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    resolveFirstBeacon?.();
    await flushMicrotasks(20);

    expect(locationBeacon).toHaveBeenCalledTimes(2);
    expect(locationBeacon).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        is_background: false,
      }),
    );
  });

  it("clears a stale native watch when stop and restart overlap an in-flight start", async () => {
    const firstWatch = createDeferred<string>();
    watchPositionMock
      .mockImplementationOnce(async () => await firstWatch.promise)
      .mockImplementationOnce(async () => "watch-2");

    const { createMobileLocationBeaconStream } = await import("../src/mobile-location-stream.js");
    const stream = createMobileLocationBeaconStream({
      client: { locationBeacon: vi.fn(async () => ({ sample: {}, events: [] })) } as never,
    });
    const config = {
      streamEnabled: true,
      distanceFilterM: 100,
      maxIntervalMs: 900_000,
      maxAccuracyM: 100,
      backgroundEnabled: true,
    } satisfies Parameters<typeof stream.start>[0];

    const firstStart = stream.start(config);
    await flushMicrotasks();
    expect(watchPositionMock).toHaveBeenCalledTimes(1);

    const stopPromise = stream.stop();
    const secondStart = stream.start(config);

    firstWatch.resolve("watch-1");
    await Promise.all([firstStart, stopPromise, secondStart]);

    expect(requestPermissionsMock).toHaveBeenCalledTimes(2);
    expect(watchPositionMock).toHaveBeenCalledTimes(2);
    expect(clearWatchMock).toHaveBeenNthCalledWith(1, { id: "watch-1" });

    await stream.stop();

    expect(clearWatchMock).toHaveBeenNthCalledWith(2, { id: "watch-2" });
  });
});
