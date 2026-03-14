import type { DesktopDisplayTarget } from "@tyrum/schemas";

export interface ScreenCapture {
  width: number;
  height: number;
  buffer: Buffer;
}

export interface DesktopBackend {
  captureScreen(display: DesktopDisplayTarget): Promise<ScreenCapture>;
  moveMouse(x: number, y: number): Promise<void>;
  clickMouse(x: number, y: number, button?: "left" | "right" | "middle"): Promise<void>;
  doubleClickMouse(x: number, y: number, button?: "left" | "right" | "middle"): Promise<void>;
  dragMouse(x: number, y: number, duration_ms?: number): Promise<void>;
  typeText(text: string): Promise<void>;
  pressKey(key: string): Promise<void>;
}

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  "base64",
);

export class MockDesktopBackend implements DesktopBackend {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];

  async captureScreen(display: DesktopDisplayTarget): Promise<ScreenCapture> {
    this.calls.push({ method: "captureScreen", args: [display] });
    return { width: 1920, height: 1080, buffer: TINY_PNG };
  }

  async moveMouse(x: number, y: number): Promise<void> {
    this.calls.push({ method: "moveMouse", args: [x, y] });
  }

  async clickMouse(x: number, y: number, button?: "left" | "right" | "middle"): Promise<void> {
    this.calls.push({ method: "clickMouse", args: [x, y, button] });
  }

  async doubleClickMouse(
    x: number,
    y: number,
    button?: "left" | "right" | "middle",
  ): Promise<void> {
    this.calls.push({ method: "doubleClickMouse", args: [x, y, button] });
  }

  async dragMouse(x: number, y: number, duration_ms?: number): Promise<void> {
    this.calls.push({ method: "dragMouse", args: [x, y, duration_ms] });
  }

  async typeText(text: string): Promise<void> {
    this.calls.push({ method: "typeText", args: [text] });
  }

  async pressKey(key: string): Promise<void> {
    this.calls.push({ method: "pressKey", args: [key] });
  }
}
