import { describe, expect, it } from "vitest";
import { calculateDistanceMeters, mapLocationCoords } from "../src/mobile-location-utils.js";

describe("mobile location utils", () => {
  it("maps native coordinates into the shared schema shape", () => {
    expect(
      mapLocationCoords({
        latitude: 52.37,
        longitude: 4.89,
        accuracy: 12,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      }),
    ).toEqual({
      latitude: 52.37,
      longitude: 4.89,
      accuracy_m: 12,
      altitude_m: null,
      altitude_accuracy_m: null,
      heading_deg: null,
      speed_mps: null,
    });
  });

  it("calculates geographic distance in meters", () => {
    const distance = calculateDistanceMeters(
      { latitude: 52.37, longitude: 4.89 },
      { latitude: 52.371, longitude: 4.891 },
    );
    expect(distance).toBeGreaterThan(100);
    expect(distance).toBeLessThan(150);
  });
});
