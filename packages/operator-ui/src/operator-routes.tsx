import type { OperatorCore } from "@tyrum/operator-core";
import type { ExecutionRun } from "@tyrum/client";
import type { LucideIcon } from "lucide-react";
import {
  Bot,
  Blocks,
  Globe,
  LayoutGrid,
  Link2,
  MessageSquare,
  Monitor,
  Play,
  Settings,
  ShieldCheck,
  SquareKanban,
} from "lucide-react";
import { lazy, type LazyExoticComponent, type ComponentType, type ReactNode } from "react";
import type { HostKind } from "./host/host-api.js";
import type { OperatorUiMode } from "./app.js";
import { ConnectPage } from "./components/pages/connect-page.js";

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
  connectionRouteId: "configure" | "desktop";
}>(() => import("./components/pages/dashboard-page.js"), "DashboardPage");
const ChatPage = lazyNamed<{ core: OperatorCore }>(
  () => import("./components/pages/chat-page.js"),
  "ChatPage",
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
  title?: string;
  statuses?: ExecutionRun["status"][];
}>(() => import("./components/pages/runs-page.js"), "RunsPage");
const PairingPage = lazyNamed<{ core: OperatorCore }>(
  () => import("./components/pages/pairing-page.js"),
  "PairingPage",
);
const ConfigurePage = lazyNamed<{ core: OperatorCore }>(
  () => import("./components/pages/configure-page.js"),
  "ConfigurePage",
);
const NodeConfigurePage = lazyNamed<{ onReloadPage?: () => void }>(
  () => import("./components/pages/node-configure-page.js"),
  "NodeConfigurePage",
);
const BrowserCapabilitiesPage = lazyNamed<Record<string, never>>(
  () => import("./components/pages/platform/browser-capabilities-page.js"),
  "BrowserCapabilitiesPage",
);
const ACTIVE_RUN_STATUSES: ExecutionRun["status"][] = ["queued", "running", "paused"];

export type OperatorUiRouteId =
  | "dashboard"
  | "chat"
  | "approvals"
  | "workboard"
  | "agents"
  | "extensions"
  | "runs"
  | "pairing"
  | "configure"
  | "desktop"
  | "browser";

export interface OperatorRouteRenderContext {
  core: OperatorCore;
  mode: OperatorUiMode;
  hostKind: HostKind;
  navigate: (id: string) => void;
  onReconfigureGateway?: (httpUrl: string, wsUrl: string) => void;
  onReloadPage?: () => void;
}

export interface OperatorRouteDefinition {
  id: OperatorUiRouteId;
  label: string;
  icon: LucideIcon;
  navGroup: "sidebar" | "platformDesktop" | "platformWeb" | "none";
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
    hostKinds: ["desktop", "web"],
    render: ({ core, hostKind, navigate }) => (
      <DashboardPage
        core={core}
        onNavigate={navigate}
        connectionRouteId={hostKind === "desktop" ? "desktop" : "configure"}
      />
    ),
  },
  {
    id: "chat",
    label: "Chat",
    icon: MessageSquare,
    navGroup: "sidebar",
    shortcut: true,
    hostKinds: ["desktop", "web"],
    render: ({ core }) => <ChatPage core={core} />,
  },
  {
    id: "approvals",
    label: "Approvals",
    icon: ShieldCheck,
    navGroup: "sidebar",
    shortcut: true,
    hostKinds: ["desktop", "web"],
    render: ({ core }) => <ApprovalsPage core={core} />,
  },
  {
    id: "workboard",
    label: "Work",
    icon: SquareKanban,
    navGroup: "sidebar",
    shortcut: true,
    hostKinds: ["desktop", "web"],
    render: ({ core }) => <WorkBoardPage core={core} />,
  },
  {
    id: "agents",
    label: "Agents",
    icon: Bot,
    navGroup: "sidebar",
    shortcut: true,
    hostKinds: ["desktop", "web"],
    render: ({ core }) => <AgentsPage core={core} />,
  },
  {
    id: "extensions",
    label: "Extensions",
    icon: Blocks,
    navGroup: "sidebar",
    shortcut: true,
    hostKinds: ["desktop", "web"],
    render: ({ core }) => <ExtensionsPage core={core} />,
  },
  {
    id: "runs",
    label: "Runs",
    icon: Play,
    navGroup: "none",
    shortcut: false,
    hostKinds: ["desktop", "web"],
    render: ({ core }) => <RunsPage core={core} statuses={ACTIVE_RUN_STATUSES} />,
  },
  {
    id: "pairing",
    label: "Nodes",
    icon: Link2,
    navGroup: "sidebar",
    shortcut: true,
    hostKinds: ["desktop", "web"],
    render: ({ core }) => <PairingPage core={core} />,
  },
  {
    id: "configure",
    label: "Configure",
    icon: Settings,
    navGroup: "sidebar",
    shortcut: true,
    hostKinds: ["desktop", "web"],
    render: ({ core }) => <ConfigurePage core={core} />,
  },
  {
    id: "desktop",
    label: "Desktop",
    icon: Monitor,
    navGroup: "platformDesktop",
    shortcut: false,
    hostKinds: ["desktop"],
    render: ({ onReloadPage }) => <NodeConfigurePage onReloadPage={onReloadPage} />,
  },
  {
    id: "browser",
    label: "Browser",
    icon: Globe,
    navGroup: "platformWeb",
    shortcut: false,
    hostKinds: ["web"],
    render: () => <BrowserCapabilitiesPage />,
  },
];

export const CONNECT_PAGE_RENDER = (context: OperatorRouteRenderContext): ReactNode => (
  <ConnectPage
    core={context.core}
    mode={context.mode}
    onReconfigureGateway={context.onReconfigureGateway}
  />
);

export function getOperatorRouteDefinition(
  routeId: OperatorUiRouteId,
): OperatorRouteDefinition | undefined {
  return OPERATOR_ROUTE_DEFINITIONS.find((route) => route.id === routeId);
}
