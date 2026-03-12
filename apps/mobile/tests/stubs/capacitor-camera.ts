export const CameraDirection = {
  Front: "front",
  Rear: "rear",
} as const;

export const CameraResultType = {
  Base64: "base64",
} as const;

export const CameraSource = {
  Camera: "camera",
} as const;

export const Camera = {
  async requestPermissions(): Promise<{ camera: "granted" }> {
    return { camera: "granted" };
  },
  async getPhoto(): Promise<{ base64String: string; format: string }> {
    return { base64String: "", format: "jpeg" };
  },
};
