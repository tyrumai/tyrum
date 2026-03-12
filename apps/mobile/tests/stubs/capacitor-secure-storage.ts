const values = new Map<string, string | Record<string, unknown>>();

export const SecureStorage = {
  async setKeyPrefix(_prefix: string): Promise<void> {},
  async getItem(key: string): Promise<string | null> {
    const value = values.get(key);
    return typeof value === "string" ? value : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    values.set(key, value);
  },
  async removeItem(key: string): Promise<void> {
    values.delete(key);
  },
  async get(key: string): Promise<Record<string, unknown> | null> {
    const value = values.get(key);
    return value && typeof value === "object" ? value : null;
  },
  async set(key: string, value: Record<string, unknown>): Promise<void> {
    values.set(key, value);
  },
};
