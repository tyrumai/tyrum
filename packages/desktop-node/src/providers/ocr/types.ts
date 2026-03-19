import type { DesktopUiRect } from "@tyrum/contracts";

export interface OcrMatch {
  text: string;
  bounds: DesktopUiRect;
  confidence?: number;
}

export interface OcrEngine {
  recognize(input: { buffer: Buffer; width: number; height: number }): Promise<OcrMatch[]>;
  reset?: () => Promise<void>;
}
