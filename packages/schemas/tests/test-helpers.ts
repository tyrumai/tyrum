import { expect } from "vitest";

type SafeParseSchema = {
  safeParse: (input: unknown) => { success: boolean };
};

export function expectRejects(schema: SafeParseSchema, input: unknown, message?: string): void {
  const parsed = schema.safeParse(input);
  expect(parsed.success, message).toBe(false);
}
