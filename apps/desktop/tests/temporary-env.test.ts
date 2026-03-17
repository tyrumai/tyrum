import { afterEach, describe, expect, it } from "vitest";
import { withTemporaryEnvVar } from "./test-utils/temporary-env.js";

const TEST_ENV_KEY = "TYRUM_TEST_TEMPORARY_ENV";

afterEach(() => {
  delete process.env[TEST_ENV_KEY];
});

describe("withTemporaryEnvVar", () => {
  it("restores an unset environment variable when the callback throws", async () => {
    await expect(
      withTemporaryEnvVar(TEST_ENV_KEY, "temporary", async () => {
        expect(process.env[TEST_ENV_KEY]).toBe("temporary");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(process.env[TEST_ENV_KEY]).toBeUndefined();
  });

  it("restores the previous environment variable value after success", async () => {
    process.env[TEST_ENV_KEY] = "original";

    await expect(
      withTemporaryEnvVar(TEST_ENV_KEY, "temporary", async () => {
        expect(process.env[TEST_ENV_KEY]).toBe("temporary");
      }),
    ).resolves.toBeUndefined();

    expect(process.env[TEST_ENV_KEY]).toBe("original");
  });
});
