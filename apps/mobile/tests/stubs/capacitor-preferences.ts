const values = new Map<string, string>();

export const Preferences = {
  async configure(_input: { group: string }): Promise<void> {},
  async get(input: { key: string }): Promise<{ value: string | null }> {
    return { value: values.get(input.key) ?? null };
  },
  async set(input: { key: string; value: string }): Promise<void> {
    values.set(input.key, input.value);
  },
  async remove(input: { key: string }): Promise<void> {
    values.delete(input.key);
  },
};
