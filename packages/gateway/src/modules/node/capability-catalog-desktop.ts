import {
  DesktopActArgs,
  DesktopActResult,
  DesktopClipboardWriteArgs,
  DesktopClipboardWriteResult,
  DesktopKeyboardArgs,
  DesktopMouseArgs,
  DesktopQueryArgs,
  DesktopQueryResult,
  DesktopScreenshotArgs,
  DesktopScreenshotResult,
  DesktopSnapshotArgs,
  DesktopSnapshotResult,
  DesktopWaitForArgs,
  DesktopWaitForResult,
} from "@tyrum/contracts";
import { z } from "zod";
import {
  createEntry,
  desktopAction,
  type CapabilityCatalogEntry,
} from "./capability-catalog-helpers.js";

export const DESKTOP_CAPABILITY_CATALOG_ENTRIES: readonly CapabilityCatalogEntry[] = [
  createEntry(
    "tyrum.desktop.screenshot",
    desktopAction(
      "screenshot",
      "Capture a desktop screenshot.",
      DesktopScreenshotArgs,
      DesktopScreenshotResult,
    ),
  ),
  createEntry(
    "tyrum.desktop.clipboard-write",
    desktopAction(
      "clipboard_write",
      "Write text to the desktop clipboard.",
      DesktopClipboardWriteArgs,
      DesktopClipboardWriteResult,
      "result",
    ),
  ),
  createEntry(
    "tyrum.desktop.snapshot",
    desktopAction(
      "snapshot",
      "Collect a desktop accessibility snapshot.",
      DesktopSnapshotArgs,
      DesktopSnapshotResult,
    ),
  ),
  createEntry(
    "tyrum.desktop.query",
    desktopAction(
      "query",
      "Query desktop UI elements.",
      DesktopQueryArgs,
      DesktopQueryResult,
      "result",
    ),
  ),
  createEntry(
    "tyrum.desktop.act",
    desktopAction(
      "act",
      "Perform a desktop UI action.",
      DesktopActArgs,
      DesktopActResult,
      "result",
    ),
  ),
  createEntry(
    "tyrum.desktop.mouse",
    desktopAction(
      "mouse",
      "Perform a low-level desktop mouse action.",
      DesktopMouseArgs,
      z.object({}).passthrough(),
      "result",
    ),
  ),
  createEntry(
    "tyrum.desktop.keyboard",
    desktopAction(
      "keyboard",
      "Perform a low-level desktop keyboard action.",
      DesktopKeyboardArgs,
      z.object({}).passthrough(),
      "result",
    ),
  ),
  createEntry(
    "tyrum.desktop.wait-for",
    desktopAction(
      "wait_for",
      "Wait for a desktop UI condition.",
      DesktopWaitForArgs,
      DesktopWaitForResult,
      "result",
    ),
  ),
];
