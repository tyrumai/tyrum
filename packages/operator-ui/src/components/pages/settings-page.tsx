import type { OperatorCore } from "@tyrum/operator-app";
import type { OperatorUiMode } from "../../app.js";
import { ThemeProvider, useThemeOptional } from "../../hooks/use-theme.js";
import { AppPage } from "../layout/app-page.js";
import { ConfigureGeneralPanel } from "./configure-general-panel.js";

function SettingsPageContent({ core, mode }: { core: OperatorCore; mode: OperatorUiMode }) {
  return (
    <AppPage contentClassName="max-w-4xl gap-5">
      <ConfigureGeneralPanel core={core} mode={mode} />
    </AppPage>
  );
}

export function SettingsPage(props: { core: OperatorCore; mode: OperatorUiMode }) {
  const existingTheme = useThemeOptional();
  const page = <SettingsPageContent {...props} />;
  return existingTheme ? page : <ThemeProvider>{page}</ThemeProvider>;
}
