import { describe, expect, it } from "vitest";
import { haversineDistanceMeters } from "../src/index.js";

describe("location helpers", () => {
  it("calculates haversine distance in meters", () => {
    const distance = haversineDistanceMeters({
      latitudeA: 52.37,
      longitudeA: 4.89,
      latitudeB: 52.371,
      longitudeB: 4.891,
    });
    expect(distance).toBeGreaterThan(100);
    expect(distance).toBeLessThan(150);
  });
});
