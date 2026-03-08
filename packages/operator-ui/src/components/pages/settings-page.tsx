import type { OperatorCore } from "@tyrum/operator-core";
import type { OperatorUiMode } from "../../app.js";
import { ThemeProvider, useThemeOptional } from "../../hooks/use-theme.js";
import { PageHeader } from "../layout/page-header.js";
import { ConfigureGeneralPanel } from "./configure-general-panel.js";

function SettingsPageContent({
  core: _core,
  mode: _mode,
}: {
  core: OperatorCore;
  mode: OperatorUiMode;
}) {
  return (
    <div className="grid gap-5">
      <PageHeader title="Settings" />
      <ConfigureGeneralPanel />
    </div>
  );
}

export function SettingsPage(props: { core: OperatorCore; mode: OperatorUiMode }) {
  const existingTheme = useThemeOptional();
  const page = <SettingsPageContent {...props} />;
  return existingTheme ? page : <ThemeProvider>{page}</ThemeProvider>;
}
