import { afterEach, describe, expect, it, vi } from "vitest";

const { captureScreenMock } = vi.hoisted(() => ({
  captureScreenMock: vi.fn(),
}));

vi.mock("@tyrum/desktop-node", () => ({
  NutJsDesktopBackend: class {
    captureScreen = captureScreenMock;
  },
}));

async function runHelperWithArg(rawPayload?: string): Promise<string> {
  vi.resetModules();

  const originalArgv = process.argv;
  const originalWrite = process.stdout.write.bind(process.stdout);
  const output: string[] = [];

  process.argv =
    rawPayload === undefined
      ? ["node", "desktop-screenshot-helper.mjs"]
      : ["node", "desktop-screenshot-helper.mjs", rawPayload];
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  }) as typeof process.stdout.write;

  try {
    await import("../src/main/desktop-screenshot-helper.js");
    await Promise.resolve();
    await Promise.resolve();
    return output.join("");
  } finally {
    process.argv = originalArgv;
    process.stdout.write = originalWrite;
  }
}

describe("desktop screenshot helper", () => {
  afterEach(() => {
    captureScreenMock.mockReset();
    vi.restoreAllMocks();
  });

  it("returns an error when the helper payload is missing", async () => {
    const output = await runHelperWithArg();

    expect(JSON.parse(output)).toEqual({
      ok: false,
      error: "Missing screen capture helper payload.",
    });
    expect(captureScreenMock).not.toHaveBeenCalled();
  });

  it("returns an error when the helper payload is invalid JSON", async () => {
    const output = await runHelperWithArg("{");

    expect(JSON.parse(output)).toEqual({
      ok: false,
      error: expect.stringContaining("Invalid screen capture helper payload:"),
    });
    expect(captureScreenMock).not.toHaveBeenCalled();
  });

  it("captures a screenshot when the payload is valid", async () => {
    captureScreenMock.mockResolvedValue({
      width: 640,
      height: 480,
      buffer: Buffer.from("png-bytes"),
    });

    const output = await runHelperWithArg(JSON.stringify({ display: "primary" }));

    expect(captureScreenMock).toHaveBeenCalledWith("primary");
    expect(JSON.parse(output)).toEqual({
      ok: true,
      width: 640,
      height: 480,
      bytesBase64: Buffer.from("png-bytes").toString("base64"),
    });
  });

  it("returns backend errors as helper failures", async () => {
    captureScreenMock.mockRejectedValue(new Error("capture failed"));

    const output = await runHelperWithArg(JSON.stringify({ display: { id: "screen-2" } }));

    expect(captureScreenMock).toHaveBeenCalledWith({ id: "screen-2" });
    expect(JSON.parse(output)).toEqual({
      ok: false,
      error: "capture failed",
    });
  });
});
