declare module "electron" {
  export const safeStorage: {
    isEncryptionAvailable(): boolean;
    encryptString(value: string): Buffer;
    decryptString(buf: Buffer): string;
  };
}

