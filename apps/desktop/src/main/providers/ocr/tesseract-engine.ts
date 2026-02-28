import type { OcrEngine, OcrMatch } from "./types.js";

type TesseractBbox = {
  x0?: number;
  y0?: number;
  x1?: number;
  y1?: number;
};

type TesseractTextItem = {
  text?: string;
  bbox?: TesseractBbox;
  confidence?: number;
};

type TesseractRecognizeResult = {
  data?: {
    lines?: TesseractTextItem[];
    words?: TesseractTextItem[];
  };
};

type TesseractWorker = {
  recognize: (image: Buffer) => Promise<TesseractRecognizeResult>;
  terminate?: () => Promise<void>;
  load?: () => Promise<void>;
  reinitialize?: (...args: unknown[]) => Promise<unknown>;
  loadLanguage?: (lang: string) => Promise<void>;
  initialize?: (lang: string) => Promise<void>;
  setParameters?: (params: Record<string, unknown>) => Promise<void>;
};

type TesseractCreateWorker = (...args: unknown[]) => Promise<TesseractWorker> | TesseractWorker;

type TesseractModule = {
  createWorker?: TesseractCreateWorker;
  default?: { createWorker?: TesseractCreateWorker };
};

function normalizeConfidence(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < 0) return 0;
  if (value <= 1) return value;
  if (value <= 100) return value / 100;
  return 1;
}

function itemToMatch(item: TesseractTextItem): OcrMatch | null {
  const text = typeof item.text === "string" ? item.text.trim() : "";
  if (!text) return null;

  const bbox = item.bbox;
  const x0 = typeof bbox?.x0 === "number" ? bbox.x0 : undefined;
  const y0 = typeof bbox?.y0 === "number" ? bbox.y0 : undefined;
  const x1 = typeof bbox?.x1 === "number" ? bbox.x1 : undefined;
  const y1 = typeof bbox?.y1 === "number" ? bbox.y1 : undefined;

  if (
    x0 === undefined ||
    y0 === undefined ||
    x1 === undefined ||
    y1 === undefined ||
    !Number.isFinite(x0) ||
    !Number.isFinite(y0) ||
    !Number.isFinite(x1) ||
    !Number.isFinite(y1)
  ) {
    return null;
  }

  return {
    text,
    bounds: {
      x: x0,
      y: y0,
      width: Math.max(0, x1 - x0),
      height: Math.max(0, y1 - y0),
    },
    confidence: normalizeConfidence(item.confidence),
  };
}

function preferredItems(data: TesseractRecognizeResult["data"] | undefined): TesseractTextItem[] {
  if (!data) return [];
  if (Array.isArray(data.lines) && data.lines.length > 0) return data.lines;
  if (Array.isArray(data.words) && data.words.length > 0) return data.words;
  return [];
}

function resolveOcrLang(): string {
  const raw = process.env["TYRUM_DESKTOP_OCR_LANG"]?.trim();
  return raw && raw.length > 0 ? raw : "eng";
}

function resolveOcrLangPath(): string | undefined {
  const raw = process.env["TYRUM_DESKTOP_OCR_LANG_PATH"]?.trim();
  return raw && raw.length > 0 ? raw : undefined;
}

let cachedEngine: OcrEngine | undefined;

export function getTesseractOcrEngine(): OcrEngine {
  cachedEngine ??= createTesseractOcrEngine();
  return cachedEngine;
}

function createTesseractOcrEngine(): OcrEngine {
  let worker: TesseractWorker | null = null;
  let workerPromise: Promise<TesseractWorker> | null = null;
  let queue: Promise<void> = Promise.resolve();

  const reset = async (): Promise<void> => {
    const current = worker;
    worker = null;
    workerPromise = null;
    queue = Promise.resolve();
    await current?.terminate?.().catch(() => undefined);
  };

  const loadWorker = async (): Promise<TesseractWorker> => {
    if (worker) return worker;
    if (workerPromise) return await workerPromise;

    const lang = resolveOcrLang();
    const langPath = resolveOcrLangPath();

    workerPromise = (async () => {
      const mod = (await import("tesseract.js")) as unknown as TesseractModule;
      const createWorker = mod.createWorker ?? mod.default?.createWorker;
      if (!createWorker) {
        throw new Error("tesseract.js missing createWorker export");
      }

      const logger = () => undefined;
      const options = { logger, ...(langPath ? { langPath } : {}) };

      let created: TesseractWorker | undefined;
      let lastError: unknown;

      for (const args of [[lang, undefined, options], [lang, options], [lang], [options]]) {
        try {
          created = await Promise.resolve(createWorker(...args));
          break;
        } catch (err) {
          lastError = err;
        }
      }

      if (!created) {
        const message = lastError instanceof Error ? lastError.message : String(lastError);
        throw new Error(`Failed to create Tesseract worker: ${message}`);
      }

      if (created.load) await created.load();
      if (created.reinitialize) {
        await created.reinitialize(lang);
      } else {
        if (created.loadLanguage) await created.loadLanguage(lang);
        if (created.initialize) await created.initialize(lang);
      }

      if (created.setParameters) {
        await created.setParameters({
          tessedit_create_hocr: "0",
          tessedit_create_tsv: "0",
        });
      }

      worker = created;
      return created;
    })().catch((err) => {
      workerPromise = null;
      throw err;
    });

    return await workerPromise;
  };

  const enqueue = async <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return await next;
  };

  return {
    async recognize(input) {
      return await enqueue(async () => {
        const w = await loadWorker();
        const res = await w.recognize(input.buffer);
        const items = preferredItems(res.data);

        const matches: OcrMatch[] = [];
        for (const item of items) {
          const match = itemToMatch(item);
          if (match) matches.push(match);
        }
        return matches;
      });
    },
    reset,
  };
}
