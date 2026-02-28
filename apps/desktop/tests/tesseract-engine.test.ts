import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createWorker = vi.fn();

vi.mock("tesseract.js", () => ({
  createWorker,
}));

const ENV_KEYS = [
  "TYRUM_DESKTOP_OCR_LANG",
  "TYRUM_DESKTOP_OCR_LANG_PATH",
  "TYRUM_DESKTOP_OCR_CACHE_PATH",
] as const;

type EnvKey = (typeof ENV_KEYS)[number];

describe("getTesseractOcrEngine", () => {
  let prevEnv: Record<EnvKey, string | undefined>;

  beforeEach(() => {
    prevEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]])) as Record<
      EnvKey,
      string | undefined
    >;
    vi.resetModules();
    createWorker.mockReset();
  });

  afterEach(async () => {
    for (const key of ENV_KEYS) {
      const value = prevEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("caches the engine per process", async () => {
    const { getTesseractOcrEngine } = await import("../src/main/providers/ocr/tesseract-engine.js");

    const a = getTesseractOcrEngine();
    const b = getTesseractOcrEngine();

    expect(a).toBe(b);
  });

  it("maps line OCR items to matches and normalizes confidence", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "tyrum-ocr-cache-test-"));
    process.env["TYRUM_DESKTOP_OCR_CACHE_PATH"] = cacheDir;

    try {
      const worker = {
        recognize: vi.fn(async () => ({
          data: {
            lines: [
              {
                text: " Save ",
                bbox: { x0: 10, y0: 20, x1: 90, y1: 44 },
                confidence: 85,
              },
            ],
          },
        })),
        setParameters: vi.fn(async () => {}),
        terminate: vi.fn(async () => {}),
      };

      createWorker.mockResolvedValue(worker);

      const { getTesseractOcrEngine } = await import("../src/main/providers/ocr/tesseract-engine.js");
      const engine = getTesseractOcrEngine();
      const matches = await engine.recognize({ buffer: Buffer.from([0x00]), width: 1, height: 1 });

      expect(createWorker).toHaveBeenCalledTimes(1);
      expect(worker.setParameters).toHaveBeenCalledTimes(1);
      expect(worker.recognize).toHaveBeenCalledTimes(1);
      expect(matches).toEqual([
        {
          text: "Save",
          bounds: { x: 10, y: 20, width: 80, height: 24 },
          confidence: 0.85,
        },
      ]);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it("falls back to words when no lines are present", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "tyrum-ocr-cache-test-"));
    process.env["TYRUM_DESKTOP_OCR_CACHE_PATH"] = cacheDir;

    try {
      const worker = {
        recognize: vi.fn(async () => ({
          data: {
            lines: [],
            words: [
              {
                text: "Cancel",
                bbox: { x0: 1, y0: 2, x1: 4, y1: 6 },
                confidence: 0.5,
              },
            ],
          },
        })),
        terminate: vi.fn(async () => {}),
      };

      createWorker.mockResolvedValue(worker);

      const { getTesseractOcrEngine } = await import("../src/main/providers/ocr/tesseract-engine.js");
      const engine = getTesseractOcrEngine();
      const matches = await engine.recognize({ buffer: Buffer.from([0x00]), width: 1, height: 1 });

      expect(matches).toEqual([
        {
          text: "Cancel",
          bounds: { x: 1, y: 2, width: 3, height: 4 },
          confidence: 0.5,
        },
      ]);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it("drops OCR items with missing bbox or text", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "tyrum-ocr-cache-test-"));
    process.env["TYRUM_DESKTOP_OCR_CACHE_PATH"] = cacheDir;

    try {
      const worker = {
        recognize: vi.fn(async () => ({
          data: {
            lines: [
              { text: "  " },
              { text: "Ok" },
              { text: "Ok", bbox: { x0: 0, y0: 0, x1: 1 } },
              { text: "Ok", bbox: { x0: 0, y0: 0, x1: 1, y1: 1 }, confidence: -1 },
              { text: "Big", bbox: { x0: 0, y0: 0, x1: 1, y1: 1 }, confidence: 999 },
            ],
          },
        })),
        terminate: vi.fn(async () => {}),
      };

      createWorker.mockResolvedValue(worker);

      const { getTesseractOcrEngine } = await import("../src/main/providers/ocr/tesseract-engine.js");
      const engine = getTesseractOcrEngine();
      const matches = await engine.recognize({ buffer: Buffer.from([0x00]), width: 1, height: 1 });

      expect(matches).toEqual([
        {
          text: "Ok",
          bounds: { x: 0, y: 0, width: 1, height: 1 },
          confidence: 0,
        },
        {
          text: "Big",
          bounds: { x: 0, y: 0, width: 1, height: 1 },
          confidence: 1,
        },
      ]);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it("reset terminates a cached worker and forces re-create", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "tyrum-ocr-cache-test-"));
    process.env["TYRUM_DESKTOP_OCR_CACHE_PATH"] = cacheDir;

    try {
      const worker = {
        recognize: vi.fn(async () => ({ data: { lines: [] } })),
        terminate: vi.fn(async () => {}),
      };

      createWorker.mockResolvedValue(worker);

      const { getTesseractOcrEngine } = await import("../src/main/providers/ocr/tesseract-engine.js");
      const engine = getTesseractOcrEngine();

      await engine.recognize({ buffer: Buffer.from([0x00]), width: 1, height: 1 });
      expect(createWorker).toHaveBeenCalledTimes(1);

      expect(engine.reset).toBeDefined();
      await engine.reset?.();
      expect(worker.terminate).toHaveBeenCalledTimes(1);

      await engine.recognize({ buffer: Buffer.from([0x00]), width: 1, height: 1 });
      expect(createWorker).toHaveBeenCalledTimes(2);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });

  it("rejects and terminates when reset happens during worker creation", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "tyrum-ocr-cache-test-"));
    process.env["TYRUM_DESKTOP_OCR_CACHE_PATH"] = cacheDir;

    try {
      let resolveWorker: ((value: unknown) => void) | undefined;
      const worker = {
        recognize: vi.fn(async () => ({ data: { lines: [] } })),
        setParameters: vi.fn(async () => {}),
        terminate: vi.fn(async () => {}),
      };

      createWorker.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveWorker = resolve;
          }),
      );

      const { getTesseractOcrEngine } = await import("../src/main/providers/ocr/tesseract-engine.js");
      const engine = getTesseractOcrEngine();

      const promise = engine.recognize({ buffer: Buffer.from([0x00]), width: 1, height: 1 });
      for (let i = 0; i < 5 && createWorker.mock.calls.length === 0; i += 1) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      expect(createWorker).toHaveBeenCalledTimes(1);

      expect(engine.reset).toBeDefined();
      await engine.reset?.();

      resolveWorker?.(worker);

      await expect(promise).rejects.toThrow(/reset/i);
      expect(worker.terminate).toHaveBeenCalledTimes(1);
    } finally {
      await rm(cacheDir, { recursive: true, force: true });
    }
  });
});
