import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";

import type { DesktopDisplayTarget } from "@tyrum/schemas";

import type { DesktopBackend, ScreenCapture } from "./desktop-backend.js";

// ---------------------------------------------------------------------------
// Internal types — kept opaque to avoid importing CJS-only @nut-tree-fork/*
// packages at the type level, which would break Node16 module resolution.
// ---------------------------------------------------------------------------

/** Minimal shape of the lazily-loaded nut-js API surface we depend on. */
interface NutJsApi {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  mouse: {
    setPosition(target: any): Promise<any>;
    click(btn: any): Promise<any>;
    drag(path: any): Promise<any>;
  };
  keyboard: {
    type(...input: any[]): Promise<any>;
    pressKey(...keys: any[]): Promise<any>;
    releaseKey(...keys: any[]): Promise<any>;
  };
  screen: {
    grab(): Promise<{
      width: number;
      height: number;
      data: Buffer;
      channels: number;
    }>;
    capture(
      fileName: string,
      fileFormat?: any,
      filePath?: string,
    ): Promise<string>;
  };
  straightTo(target: any): Promise<any[]>;
  Point: new (x: number, y: number) => { x: number; y: number };
  Button: Record<string, number>;
  Key: Record<string, number>;
  imageToJimp(image: any): { getBufferAsync(mime: string): Promise<Buffer> };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * Real desktop automation backend powered by @nut-tree-fork/nut-js.
 *
 * The native module is loaded lazily on first use so the application does not
 * crash at startup when the required system libraries (X11 dev headers on
 * Linux, etc.) are missing.
 */
export class NutJsDesktopBackend implements DesktopBackend {
  private api: NutJsApi | null = null;

  /** Lazy-load the native module. Throws a descriptive error if unavailable. */
  private async load(): Promise<NutJsApi> {
    if (this.api) return this.api;

    try {
      // Dynamic import of a CJS package — Node resolves this fine at runtime.
      const nutjs = await import("@nut-tree-fork/nut-js");
      this.api = {
        mouse: nutjs.mouse,
        keyboard: nutjs.keyboard,
        screen: nutjs.screen,
        straightTo: nutjs.straightTo,
        Point: nutjs.Point,
        Button: nutjs.Button as unknown as Record<string, number>,
        Key: nutjs.Key as unknown as Record<string, number>,
        imageToJimp: nutjs.imageToJimp,
      };
      return this.api;
    } catch (err) {
      throw new Error(
        `Desktop automation unavailable: failed to load @nut-tree-fork/nut-js. ` +
          `On Linux, ensure X11 dev libraries are installed. ` +
          `Error: ${(err as Error).message}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Screen capture
  // ---------------------------------------------------------------------------

  async captureScreen(_display: DesktopDisplayTarget): Promise<ScreenCapture> {
    const { screen, imageToJimp } = await this.load();

    try {
      // grab() returns an Image with raw BGR pixel data
      const image = await screen.grab();
      const { width, height } = image;

      // Convert raw pixel data to PNG via Jimp
      const jimp = imageToJimp(image);
      const buffer = await jimp.getBufferAsync("image/png");

      return { width, height, buffer: Buffer.from(buffer) };
    } catch {
      // Fallback: use capture() which writes a PNG to disk
      return this.captureScreenViaFile();
    }
  }

  /**
   * Fallback capture path: write a temporary PNG via `screen.capture()`,
   * read it back into memory, and delete the temp file.
   */
  private async captureScreenViaFile(): Promise<ScreenCapture> {
    const { screen } = await this.load();
    const fileName = `tyrum-screenshot-${Date.now()}`;
    const filePath = tmpdir();

    try {
      const outputPath = await screen.capture(fileName, undefined, filePath);
      const buffer = await readFile(outputPath);

      // PNG header encodes dimensions at bytes 16-23 (big-endian uint32)
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);

      // Best-effort cleanup of temp file
      await unlink(outputPath).catch(() => {});

      return { width, height, buffer };
    } catch (err) {
      throw new Error(
        `Screen capture failed: ${(err as Error).message}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Mouse
  // ---------------------------------------------------------------------------

  async moveMouse(x: number, y: number): Promise<void> {
    const { mouse, Point } = await this.load();

    try {
      await mouse.setPosition(new Point(x, y));
    } catch (err) {
      throw new Error(
        `Mouse move to (${x}, ${y}) failed: ${(err as Error).message}`,
      );
    }
  }

  async clickMouse(
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
      await mouse.click(btn);
    } catch (err) {
      throw new Error(
        `Mouse click at (${x}, ${y}) failed: ${(err as Error).message}`,
      );
    }
  }

  async dragMouse(x: number, y: number, _duration_ms?: number): Promise<void> {
    const { mouse, straightTo, Point } = await this.load();

    try {
      await mouse.drag(straightTo(new Point(x, y)));
    } catch (err) {
      throw new Error(
        `Mouse drag to (${x}, ${y}) failed: ${(err as Error).message}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------

  async typeText(text: string): Promise<void> {
    const { keyboard } = await this.load();

    try {
      await keyboard.type(text);
    } catch (err) {
      throw new Error(
        `Keyboard type failed: ${(err as Error).message}`,
      );
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
      throw new Error(
        `Keyboard press "${key}" failed: ${(err as Error).message}`,
      );
    }
  }
}
