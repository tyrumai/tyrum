import type { OperatorCore } from "@tyrum/operator-core";
import type { OperatorUiMode } from "../../app.js";
import { PageHeader } from "../layout/page-header.js";
import { ConfigureGeneralPanel } from "./configure-general-panel.js";

export function SettingsPage({
  core: _core,
  mode: _mode,
}: {
  core: OperatorCore;
  mode: OperatorUiMode;
}) {
  return (
    <div className="grid gap-6">
      <PageHeader title="Settings" />
      <ConfigureGeneralPanel />
    </div>
  );
}
