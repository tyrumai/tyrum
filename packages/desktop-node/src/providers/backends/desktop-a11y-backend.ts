import type {
  DesktopActArgs,
  DesktopQueryArgs,
  DesktopQueryMatch,
  DesktopSnapshotArgs,
  DesktopUiTree,
  DesktopWindow,
} from "@tyrum/schemas";

export type DesktopA11ySnapshot = {
  windows: DesktopWindow[];
  tree: DesktopUiTree;
};

export type DesktopA11yActResult = {
  resolved_element_ref?: string;
};

/**
 * Accessibility backend for desktop automation (AT-SPI on Linux).
 *
 * Keep this surface minimal; the provider owns permissions, fallbacks, and evidence.
 */
export interface DesktopA11yBackend {
  isAvailable(): Promise<boolean>;
  snapshot(args: DesktopSnapshotArgs): Promise<DesktopA11ySnapshot>;
  query(args: DesktopQueryArgs): Promise<DesktopQueryMatch[]>;
  act(args: DesktopActArgs): Promise<DesktopA11yActResult>;
}
