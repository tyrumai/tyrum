import { describe, expect, it, vi } from "vitest";
import type { ActionPrimitive } from "@tyrum/contracts";
import { DesktopProvider, MockDesktopBackend, type ConfirmationFn } from "@tyrum/desktop-node";
import { resolvePermissions } from "../src/main/config/permissions.js";

function makeAction(args: Record<string, unknown>): ActionPrimitive {
  return { type: "Desktop", args };
}

function makeClipboardBackend(options?: {
  supportsClipboardWrite?: boolean;
  writeClipboardText?: (text: string) => Promise<void>;
}) {
  const backend = new MockDesktopBackend();
  return Object.assign(backend, {
    supportsClipboardWrite: options?.supportsClipboardWrite ?? true,
    writeClipboardText:
      options?.writeClipboardText ??
      vi.fn(async (_text: string) => {
        return;
      }),
  });
}

describe("DesktopProvider clipboard writes", () => {
  it("advertises clipboard-write when the backend supports it", () => {
    const provider = new DesktopProvider(
      makeClipboardBackend(),
      resolvePermissions("balanced", {}),
      vi.fn<ConfirmationFn>(),
    );

    expect(provider.capabilityIds).toContain("tyrum.desktop.clipboard-write");
  });

  it("keeps clipboard plaintext out of approval prompts and results", async () => {
    const confirmFn = vi.fn<ConfirmationFn>().mockResolvedValue(true);
    const provider = new DesktopProvider(
      makeClipboardBackend(),
      resolvePermissions("balanced", {}),
      confirmFn,
    );

    const result = await provider.execute(
      makeAction({
        op: "clipboard_write",
        text: "super-secret-clipboard-text",
      }),
    );

    expect(confirmFn).toHaveBeenCalledWith("Allow clipboard write?");
    expect(result.success).toBe(true);
    expect(result.result).toEqual({
      op: "clipboard_write",
      status: "ok",
    });
    expect(result.result).not.toHaveProperty("text");
    expect(result.evidence).not.toHaveProperty("text");
  });

  it("returns an unsupported error when the backend cannot write", async () => {
    const provider = new DesktopProvider(
      makeClipboardBackend({ supportsClipboardWrite: false }),
      resolvePermissions("poweruser", {}),
      vi.fn<ConfirmationFn>(),
    );

    const result = await provider.execute(
      makeAction({
        op: "clipboard_write",
        text: "copy me",
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Clipboard write is unavailable");
  });

  it("redacts the attempted payload from backend errors", async () => {
    const provider = new DesktopProvider(
      makeClipboardBackend({
        writeClipboardText: vi.fn(async () => {
          throw new Error("failed to copy super-secret-clipboard-text");
        }),
      }),
      resolvePermissions("poweruser", {}),
      vi.fn<ConfirmationFn>(),
    );

    const result = await provider.execute(
      makeAction({
        op: "clipboard_write",
        text: "super-secret-clipboard-text",
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Clipboard write failed");
    expect(result.error).not.toContain("super-secret-clipboard-text");
  });

  it("does not advertise clipboard-write when the backend lacks support", () => {
    const provider = new DesktopProvider(
      makeClipboardBackend({ supportsClipboardWrite: false }),
      resolvePermissions("safe", {}),
      vi.fn<ConfirmationFn>(),
    );

    expect(provider.capabilityIds).not.toContain("tyrum.desktop.clipboard-write");
  });
});
