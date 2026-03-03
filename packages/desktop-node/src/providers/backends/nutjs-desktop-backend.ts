import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";

import type { DesktopDisplayTarget } from "@tyrum/schemas";

import type { DesktopBackend, ScreenCapture } from "./desktop-backend.js";

type NutPoint = { x: number; y: number };
type NutMousePath = unknown;
type NutImage = { width: number; height: number; data: Buffer; channels: number };

interface NutJsApi {
  mouse: {
    setPosition(target: NutPoint): Promise<unknown>;
    click(btn: number): Promise<unknown>;
    doubleClick(btn: number): Promise<unknown>;
    drag(path: NutMousePath): Promise<unknown>;
  };
  keyboard: {
    type(...input: unknown[]): Promise<unknown>;
    pressKey(...keys: number[]): Promise<unknown>;
    releaseKey(...keys: number[]): Promise<unknown>;
  };
  screen: {
    grab(): Promise<NutImage>;
    capture(fileName: string, fileFormat?: unknown, filePath?: string): Promise<string>;
  };
  straightTo(target: NutPoint): NutMousePath;
  Point: new (x: number, y: number) => NutPoint;
  Button: Record<string, number>;
  Key: Record<string, number>;
  imageToJimp(image: NutImage): { getBufferAsync(mime: string): Promise<Buffer> };
}

export class NutJsDesktopBackend implements DesktopBackend {
  private api: NutJsApi | null = null;

  private async load(): Promise<NutJsApi> {
    if (this.api) return this.api;

    try {
      const nutjs = await import("@nut-tree-fork/nut-js");
      const api: NutJsApi = {
        mouse: nutjs.mouse,
        keyboard: nutjs.keyboard,
        screen: nutjs.screen,
        straightTo: nutjs.straightTo,
        Point: nutjs.Point,
        Button: nutjs.Button as unknown as Record<string, number>,
        Key: nutjs.Key as unknown as Record<string, number>,
        imageToJimp: nutjs.imageToJimp,
      };
      this.api = api;
      return api;
    } catch (err) {
      throw new Error(
        `Desktop automation unavailable: failed to load @nut-tree-fork/nut-js. ` +
          `On Linux, ensure X11 dev libraries are installed. ` +
          `Error: ${(err as Error).message}`,
      );
    }
  }

  async captureScreen(_display: DesktopDisplayTarget): Promise<ScreenCapture> {
    const { screen, imageToJimp } = await this.load();

    try {
      const image = await screen.grab();
      const { width, height } = image;

      const jimp = imageToJimp(image);
      const buffer = await jimp.getBufferAsync("image/png");

      return { width, height, buffer: Buffer.from(buffer) };
    } catch {
      return this.captureScreenViaFile();
    }
  }

  private async captureScreenViaFile(): Promise<ScreenCapture> {
    const { screen } = await this.load();
    const fileName = `tyrum-screenshot-${Date.now()}`;
    const filePath = tmpdir();

    try {
      const outputPath = await screen.capture(fileName, undefined, filePath);
      const buffer = await readFile(outputPath);

      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);

      await unlink(outputPath).catch(() => {});

      return { width, height, buffer };
    } catch (err) {
      throw new Error(`Screen capture failed: ${(err as Error).message}`);
    }
  }

  async moveMouse(x: number, y: number): Promise<void> {
    const { mouse, Point } = await this.load();

    try {
      await mouse.setPosition(new Point(x, y));
    } catch (err) {
      throw new Error(`Mouse move to (${x}, ${y}) failed: ${(err as Error).message}`);
    }
  }

  async clickMouse(x: number, y: number, button?: "left" | "right" | "middle"): Promise<void> {
    const { mouse, Point, Button } = await this.load();

    const btn =
      button === "right"
        ? Button["RIGHT"]
        : button === "middle"
          ? Button["MIDDLE"]
          : Button["LEFT"];

    try {
      await mouse.setPosition(new Point(x, y));
      await mouse.click(btn ?? Button["LEFT"]!);
    } catch (err) {
      throw new Error(`Mouse click at (${x}, ${y}) failed: ${(err as Error).message}`);
    }
  }

  async doubleClickMouse(
    x: number,
    y: number,
    button?: "left" | "right" | "middle",
  ): Promise<void> {
    const { mouse, Point, Button } = await this.load();

    const btn =
      button === "right"
        ? Button["RIGHT"]
        : button === "middle"
          ? Button["MIDDLE"]
          : Button["LEFT"];

    try {
      await mouse.setPosition(new Point(x, y));
      await mouse.doubleClick(btn ?? Button["LEFT"]!);
    } catch (err) {
      throw new Error(`Mouse double click at (${x}, ${y}) failed: ${(err as Error).message}`);
    }
  }

  async dragMouse(x: number, y: number, _duration_ms?: number): Promise<void> {
    const { mouse, straightTo, Point } = await this.load();

    try {
      await mouse.drag(straightTo(new Point(x, y)));
    } catch (err) {
      throw new Error(`Mouse drag to (${x}, ${y}) failed: ${(err as Error).message}`);
    }
  }

  async typeText(text: string): Promise<void> {
    const { keyboard } = await this.load();

    try {
      await keyboard.type(text);
    } catch (err) {
      throw new Error(`Keyboard type failed: ${(err as Error).message}`);
    }
  }

  async pressKey(key: string): Promise<void> {
    const { keyboard, Key } = await this.load();

    const keyEnum = Key[key];
    if (keyEnum === undefined) {
      throw new Error(
        `Unknown key: "${key}". ` +
          `Use Key enum names like "Enter", "Tab", "Escape", "A", "Space".`,
      );
    }

    try {
      await keyboard.pressKey(keyEnum);
      await keyboard.releaseKey(keyEnum);
    } catch (err) {
      throw new Error(`Keyboard press "${key}" failed: ${(err as Error).message}`);
    }
  }
}
