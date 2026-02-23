import { afterEach, describe, expect, it, vi } from "vitest";

const closeDb = vi.fn(async () => {});
const ensureLoaded = vi.fn(async () => {
  throw new Error("models.dev load failed");
});
const listProviders = vi.fn(async () => []);
const createContainerAsync = vi.fn(async () => {
  return {
    db: { close: closeDb },
    modelsDev: { ensureLoaded },
    oauthProviderRegistry: { list: listProviders },
  } as any;
});

vi.mock("../../src/container.js", () => {
  return {
    createContainer: vi.fn(),
    createContainerAsync,
  };
});

describe("tyrum check", () => {
  afterEach(() => {
    closeDb.mockClear();
    ensureLoaded.mockClear();
    listProviders.mockClear();
    createContainerAsync.mockClear();
    delete process.env["GATEWAY_DB_PATH"];
  });

  it("closes the database connection on check failure", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    process.env["GATEWAY_DB_PATH"] = ":memory:";

    const { runCli } = await import("../../src/index.js");
    const code = await runCli(["check"]);

    expect(code).toBe(1);
    expect(closeDb).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
  });
});

