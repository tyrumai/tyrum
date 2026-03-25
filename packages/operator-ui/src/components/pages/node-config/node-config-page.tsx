import type { OperatorCore } from "@tyrum/operator-app";
import { useCallback, type ReactNode } from "react";
import type { DesktopApi } from "../../../desktop-api.js";
import { useHostApi } from "../../../host/host-api.js";
import { useTranslateNode } from "../../../i18n-helpers.js";
import { useReconnectScrollArea } from "../../../reconnect-ui-state.js";
import { AppPage } from "../../layout/app-page.js";
import { Alert } from "../../ui/alert.js";
import { Badge } from "../../ui/badge.js";
import { Card, CardContent } from "../../ui/card.js";
import { LoadingState } from "../../ui/loading-state.js";
import { useNodeConfigBrowser } from "./adapter-browser.js";
import { useNodeConfigDesktop } from "./adapter-desktop.js";
import { useNodeConfigMobile } from "./adapter-mobile.js";
import { CapabilitySection } from "./node-config-page.capability-section.js";
import { ConnectionSection } from "./node-config-page.connection-section.js";
import { ExecutorSection } from "./node-config-page.executor-section.js";
import type { UnifiedNodeConfigModel } from "./node-config-page.types.js";

// ─── Public API ──────────────────────────────────────────────────────────────

export interface NodeConfigPageProps {
  /** For desktop test dispatch and mobile test dispatch. */
  core?: OperatorCore;
  /** Desktop: reload page after connection change. */
  onReloadPage?: () => void;
}

export function NodeConfigPage({ core, onReloadPage }: NodeConfigPageProps) {
  const host = useHostApi();

  switch (host.kind) {
    case "desktop":
      return <DesktopNodeConfigPage api={host.api} core={core} onReloadPage={onReloadPage} />;
    case "web":
      return <BrowserNodeConfigPage core={core} />;
    case "mobile":
      return <MobileNodeConfigPage core={core} />;
  }
}

// ─── Desktop inner component ─────────────────────────────────────────────────

function DesktopNodeConfigPage({
  api,
  core,
  onReloadPage,
}: {
  api: DesktopApi | null;
  core?: OperatorCore;
  onReloadPage?: () => void;
}) {
  if (!api) {
    return (
      <AppPage contentClassName="max-w-5xl gap-4">
        <Alert variant="error" title="Desktop API not available." />
      </AppPage>
    );
  }

  return <DesktopNodeConfigPageInner api={api} core={core} onReloadPage={onReloadPage} />;
}

function DesktopNodeConfigPageInner({
  api,
  core,
  onReloadPage,
}: {
  api: DesktopApi;
  core?: OperatorCore;
  onReloadPage?: () => void;
}) {
  void core; // Reserved for desktop test dispatch in a future pass.
  const model = useNodeConfigDesktop(api, onReloadPage);
  return <NodeConfigPageLayout model={model} />;
}

// ─── Browser inner component ─────────────────────────────────────────────────

function BrowserNodeConfigPage({ core }: { core?: OperatorCore }) {
  const wsUrl = core?.wsUrl ?? "";
  const model = useNodeConfigBrowser(wsUrl);
  return <NodeConfigPageLayout model={model} />;
}

// ─── Mobile inner component ─────────────────────────────────────────────────

function MobileNodeConfigPage({ core }: { core?: OperatorCore }) {
  const dispatchTest = useCallback(
    async (_actionName: string, _input: Record<string, unknown>): Promise<unknown> => {
      // Mobile test dispatch placeholder — will delegate through core.admin when wired.
      return undefined;
    },
    [],
  );

  const model = useNodeConfigMobile({ dispatchTest: core ? dispatchTest : undefined });
  return <NodeConfigPageLayout model={model} />;
}

// ─── Section label ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: ReactNode }) {
  const translateNode = useTranslateNode();
  return (
    <div className="flex items-center gap-2.5 pt-3">
      <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-fg-muted/60">
        {translateNode(children)}
      </span>
      <div className="flex-1 h-px bg-border/50" />
    </div>
  );
}

// ─── Shared layout ───────────────────────────────────────────────────────────

function NodeConfigPageLayout({ model }: { model: UnifiedNodeConfigModel }) {
  const translateNode = useTranslateNode();
  const scrollAreaRef = useReconnectScrollArea(`node-config:${model.platform}`);
  if (model.loading) {
    return (
      <AppPage contentClassName="max-w-5xl gap-4">
        <Card>
          <CardContent className="pt-6">
            <LoadingState label="Loading node settings…" />
          </CardContent>
        </Card>
      </AppPage>
    );
  }

  if (model.loadError) {
    return (
      <AppPage contentClassName="max-w-5xl gap-4">
        <Alert variant="error" title="Failed to load node settings" description={model.loadError} />
      </AppPage>
    );
  }

  const platformLabel =
    model.platform === "desktop"
      ? "Desktop"
      : model.platform === "browser"
        ? "Browser"
        : model.connection.mode === "readonly" && model.connection.platform
          ? model.connection.platform
          : "Mobile";

  return (
    <AppPage contentClassName="max-w-5xl gap-4" scrollAreaRef={scrollAreaRef}>
      {/* Page header */}
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-lg font-semibold text-fg">{translateNode("Node Configuration")}</h2>
          <Badge variant="outline">{platformLabel}</Badge>
        </div>
        <p className="text-sm text-fg-muted mt-1">
          {translateNode("Manage the local node executor, connection, and capability settings.")}
        </p>
      </div>

      {/* Section: Connection */}
      <SectionLabel>Connection</SectionLabel>
      <ConnectionSection connection={model.connection} />

      {/* Section: Node Executor */}
      <SectionLabel>Node Executor</SectionLabel>
      <ExecutorSection executor={model.executor} platformLabel={platformLabel} />

      {/* Section: Capabilities */}
      <SectionLabel>Capabilities</SectionLabel>
      {model.capabilities.map((cap) => (
        <CapabilitySection key={cap.key} capability={cap} />
      ))}
    </AppPage>
  );
}
