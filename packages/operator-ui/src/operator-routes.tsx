import type { OperatorCore } from "@tyrum/operator-core";
import type { ExecutionRun } from "@tyrum/client";
import type { LucideIcon } from "lucide-react";
import {
  Bot,
  Blocks,
  Boxes,
  Globe,
  LayoutGrid,
  Link2,
  MessageSquare,
  Monitor,
  Play,
  Settings,
  ShieldCheck,
  Smartphone,
  SquareKanban,
} from "lucide-react";
import { lazy, type LazyExoticComponent, type ComponentType, type ReactNode } from "react";
import type { HostKind } from "./host/host-api.js";
import type { OperatorUiMode } from "./app.js";
import { ConnectPage } from "./components/pages/connect-page.js";
import type { WebAuthPersistence } from "./web-auth.js";

function lazyNamed<TProps>(
  loader: () => Promise<Record<string, unknown>>,
  exportName: string,
): LazyExoticComponent<ComponentType<TProps>> {
  return lazy(async () => {
    const mod = await loader();
    return { default: mod[exportName] as ComponentType<TProps> };
  });
}

const DashboardPage = lazyNamed<{
  core: OperatorCore;
  onNavigate: (id: string) => void;
  onboardingAvailable?: boolean;
  onOpenOnboarding?: () => void;
  connectionRouteId: "configure" | "desktop" | "mobile";
}>(() => import("./components/pages/dashboard-page.js"), "DashboardPage");
const ChatPage = lazyNamed<{ core: OperatorCore }>(
  () => import("./components/pages/chat-page-ai-sdk.js"),
  "AiSdkChatPage",
);
const ApprovalsPage = lazyNamed<{ core: OperatorCore }>(
  () => import("./components/pages/approvals-page.js"),
  "ApprovalsPage",
);
const WorkBoardPage = lazyNamed<{ core: OperatorCore }>(
  () => import("./components/pages/workboard-page.js"),
  "WorkBoardPage",
);
const AgentsPage = lazyNamed<{ core: OperatorCore }>(
  () => import("./components/pages/agents-page.js"),
  "AgentsPage",
);
const ExtensionsPage = lazyNamed<{ core: OperatorCore }>(
  () => import("./components/pages/extensions-page.js"),
  "ExtensionsPage",
);
const RunsPage = lazyNamed<{
  core: OperatorCore;
  statuses?: ExecutionRun["status"][];
}>(() => import("./components/pages/runs-page.js"), "RunsPage");
const PairingPage = lazyNamed<{ core: OperatorCore }>(
  () => import("./components/pages/pairing-page.js"),
  "PairingPage",
);
const DesktopEnvironmentsPage = lazyNamed<{ core: OperatorCore; mode?: OperatorUiMode }>(
  () => import("./components/pages/desktop-environments-page.js"),
  "DesktopEnvironmentsPage",
);
const ConfigurePage = lazyNamed<{
  core: OperatorCore;
  mode: OperatorUiMode;
  webAuthPersistence?: WebAuthPersistence;
}>(() => import("./components/pages/configure-page.js"), "ConfigurePage");
const NodeConfigPage = lazyNamed<{ core?: OperatorCore; onReloadPage?: () => void }>(
  () => import("./components/pages/node-config/node-config-page.js"),
  "NodeConfigPage",
);
const ACTIVE_RUN_STATUSES: ExecutionRun["status"][] = ["queued", "running", "paused"];
const SHARED_HOST_KINDS = ["desktop", "mobile", "web"] as const satisfies readonly HostKind[];

export type OperatorUiRouteId =
  | "dashboard"
  | "chat"
  | "approvals"
  | "workboard"
  | "agents"
  | "extensions"
  | "runs"
  | "pairing"
  | "desktop-environments"
  | "configure"
  | "desktop"
  | "browser"
  | "mobile";

export interface OperatorRouteRenderContext {
  core: OperatorCore;
  mode: OperatorUiMode;
  hostKind: HostKind;
  navigate: (id: string) => void;
  onboardingAvailable?: boolean;
  onOpenOnboarding?: () => void;
  onReconfigureGateway?: (httpUrl: string, wsUrl: string) => void;
  onReloadPage?: () => void;
  webAuthPersistence?: WebAuthPersistence;
}

export interface OperatorRouteDefinition {
  id: OperatorUiRouteId;
  label: string;
  icon: LucideIcon;
  navGroup: "sidebar" | "platformDesktop" | "platformMobile" | "platformWeb" | "none";
  shortcut: boolean;
  hostKinds: readonly HostKind[];
  render(context: OperatorRouteRenderContext): ReactNode;
}

export const OPERATOR_ROUTE_DEFINITIONS: readonly OperatorRouteDefinition[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: LayoutGrid,
    navGroup: "sidebar",
    shortcut: true,
    hostKinds: SHARED_HOST_KINDS,
    render: ({ core, hostKind, navigate, onboardingAvailable, onOpenOnboarding }) => (
      <DashboardPage
        core={core}
        onNavigate={navigate}
        onboardingAvailable={onboardingAvailable}
        onOpenOnboarding={onOpenOnboarding}
        connectionRouteId={hostKind === "desktop" || hostKind === "mobile" ? hostKind : "configure"}
      />
    ),
  },
  {
    id: "chat",
    label: "Chat",
    icon: MessageSquare,
    navGroup: "sidebar",
    shortcut: true,
    hostKinds: SHARED_HOST_KINDS,
    render: ({ core }) => <ChatPage core={core} />,
  },
  {
    id: "approvals",
    label: "Approvals",
    icon: ShieldCheck,
    navGroup: "sidebar",
    shortcut: true,
    hostKinds: SHARED_HOST_KINDS,
    render: ({ core }) => <ApprovalsPage core={core} />,
  },
  {
    id: "workboard",
    label: "Work",
    icon: SquareKanban,
    navGroup: "sidebar",
    shortcut: true,
    hostKinds: SHARED_HOST_KINDS,
    render: ({ core }) => <WorkBoardPage core={core} />,
  },
  {
    id: "agents",
    label: "Agents",
    icon: Bot,
    navGroup: "sidebar",
    shortcut: true,
    hostKinds: SHARED_HOST_KINDS,
    render: ({ core }) => <AgentsPage core={core} />,
  },
  {
    id: "extensions",
    label: "Extensions",
    icon: Blocks,
    navGroup: "sidebar",
    shortcut: true,
    hostKinds: SHARED_HOST_KINDS,
    render: ({ core }) => <ExtensionsPage core={core} />,
  },
  {
    id: "runs",
    label: "Runs",
    icon: Play,
    navGroup: "none",
    shortcut: false,
    hostKinds: SHARED_HOST_KINDS,
    render: ({ core }) => <RunsPage core={core} statuses={ACTIVE_RUN_STATUSES} />,
  },
  {
    id: "pairing",
    label: "Nodes",
    icon: Link2,
    navGroup: "sidebar",
    shortcut: true,
    hostKinds: SHARED_HOST_KINDS,
    render: ({ core }) => <PairingPage core={core} />,
  },
  {
    id: "desktop-environments",
    label: "Desktops",
    icon: Boxes,
    navGroup: "sidebar",
    shortcut: false,
    hostKinds: SHARED_HOST_KINDS,
    render: ({ core, mode }) => <DesktopEnvironmentsPage core={core} mode={mode} />,
  },
  {
    id: "configure",
    label: "Configure",
    icon: Settings,
    navGroup: "sidebar",
    shortcut: true,
    hostKinds: SHARED_HOST_KINDS,
    render: ({ core, mode, webAuthPersistence }) => (
      <ConfigurePage core={core} mode={mode} webAuthPersistence={webAuthPersistence} />
    ),
  },
  {
    id: "desktop",
    label: "Desktop",
    icon: Monitor,
    navGroup: "platformDesktop",
    shortcut: false,
    hostKinds: ["desktop"],
    render: ({ core, onReloadPage }) => <NodeConfigPage core={core} onReloadPage={onReloadPage} />,
  },
  {
    id: "browser",
    label: "Browser",
    icon: Globe,
    navGroup: "platformWeb",
    shortcut: false,
    hostKinds: ["web"],
    render: ({ core }) => <NodeConfigPage core={core} />,
  },
  {
    id: "mobile",
    label: "Mobile",
    icon: Smartphone,
    navGroup: "platformMobile",
    shortcut: false,
    hostKinds: ["mobile"],
    render: ({ core }) => <NodeConfigPage core={core} />,
  },
];

export const CONNECT_PAGE_RENDER = (context: OperatorRouteRenderContext): ReactNode => (
  <ConnectPage
    core={context.core}
    mode={context.mode}
    onReconfigureGateway={context.onReconfigureGateway}
    webAuthPersistence={context.webAuthPersistence}
  />
);

export function getOperatorRouteDefinition(
  routeId: OperatorUiRouteId,
): OperatorRouteDefinition | undefined {
  return OPERATOR_ROUTE_DEFINITIONS.find((route) => route.id === routeId);
}
