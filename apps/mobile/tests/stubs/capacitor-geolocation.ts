export const Geolocation = {
  async requestPermissions(): Promise<{ location: "granted" }> {
    return { location: "granted" };
  },
  async getCurrentPosition(): Promise<{
    coords: {
      latitude: number;
      longitude: number;
      accuracy: number;
      altitude: number | null;
      altitudeAccuracy: number | null;
      heading: number | null;
      speed: number | null;
    };
    timestamp: number;
  }> {
    return {
      coords: {
        latitude: 0,
        longitude: 0,
        accuracy: 0,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
      timestamp: Date.now(),
    };
  },
};
