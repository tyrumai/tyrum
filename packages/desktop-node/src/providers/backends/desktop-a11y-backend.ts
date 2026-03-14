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

export interface DesktopA11yBackend {
  isAvailable(): Promise<boolean>;
  snapshot(args: DesktopSnapshotArgs): Promise<DesktopA11ySnapshot>;
  query(args: DesktopQueryArgs): Promise<DesktopQueryMatch[]>;
  act(args: DesktopActArgs): Promise<DesktopA11yActResult>;
}
