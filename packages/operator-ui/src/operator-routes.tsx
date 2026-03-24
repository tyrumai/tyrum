import type { OperatorCore } from "@tyrum/operator-app";
import type { LucideIcon } from "lucide-react";
import {
  Bot,
  Blocks,
  Boxes,
  Brain,
  CalendarClock,
  Globe,
  LayoutGrid,
  Link2,
  MessageSquare,
  Monitor,
  Settings,
  ShieldCheck,
  Smartphone,
  SquareKanban,
} from "lucide-react";
import { lazy, type LazyExoticComponent, type ComponentType, type ReactNode } from "react";
import type { HostKind } from "./host/host-api.js";
import type { OperatorUiMode } from "./app.js";
import type { AgentsPageNavigationIntent } from "./components/pages/agents-page.lib.js";
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
  onNavigate: (id: string, tab?: string) => void;
  onOpenAgentRun?: (intent: AgentsPageNavigationIntent) => void;
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
const WorkBoardPage = lazyNamed<{ core: OperatorCore; onNavigate: (id: string) => void }>(
  () => import("./components/pages/workboard-page.js"),
  "WorkBoardPage",
);
const AgentsPage = lazyNamed<{
  core: OperatorCore;
  navigationIntent?: AgentsPageNavigationIntent | null;
  onNavigationIntentHandled?: () => void;
}>(() => import("./components/pages/agents-page.js"), "AgentsPage");
const ExtensionsPage = lazyNamed<{ core: OperatorCore }>(
  () => import("./components/pages/extensions-page.js"),
  "ExtensionsPage",
);
const MemoryPage = lazyNamed<{ core: OperatorCore }>(
  () => import("./components/pages/memory-page.js"),
  "MemoryPage",
);
const SchedulesPage = lazyNamed<{ core: OperatorCore }>(
  () => import("./components/pages/schedules-page.js"),
  "SchedulesPage",
);
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
  initialTab?: string;
  onTabChange?: (tab: string) => void;
}>(() => import("./components/pages/configure-page.js"), "ConfigurePage");
const NodeConfigPage = lazyNamed<{ core?: OperatorCore; onReloadPage?: () => void }>(
  () => import("./components/pages/node-config/node-config-page.js"),
  "NodeConfigPage",
);
const SHARED_HOST_KINDS = ["desktop", "mobile", "web"] as const satisfies readonly HostKind[];

export type OperatorUiRouteId =
  | "dashboard"
  | "chat"
  | "approvals"
  | "workboard"
  | "agents"
  | "extensions"
  | "memory"
  | "schedules"
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
  navigate: (id: string, tab?: string) => void;
  onOpenAgentRun?: (intent: AgentsPageNavigationIntent) => void;
  agentsNavigationIntent?: AgentsPageNavigationIntent | null;
  onAgentsNavigationIntentHandled?: () => void;
  onboardingAvailable?: boolean;
  onOpenOnboarding?: () => void;
  onReconfigureGateway?: (httpUrl: string, wsUrl: string) => void;
  onReloadPage?: () => void;
  webAuthPersistence?: WebAuthPersistence;
  initialConfigureTab?: string;
  onConfigureTabChange?: (tab: string) => void;
}

export type SidebarSectionId = "operate" | "build" | "system";

export const SIDEBAR_SECTION_LABELS: Record<SidebarSectionId, string> = {
  operate: "Operate",
  build: "Build",
  system: "System",
};

export interface OperatorRouteDefinition {
  id: OperatorUiRouteId;
  label: string;
  icon: LucideIcon;
  navGroup: "sidebar" | "platformDesktop" | "platformMobile" | "platformWeb" | "none";
  sidebarSection?: SidebarSectionId;
  shortcut: boolean;
  hostKinds: readonly HostKind[];
  render(context: OperatorRouteRenderContext): ReactNode;
}

export const OPERATOR_ROUTE_DEFINITIONS: readonly OperatorRouteDefinition[] = [
  // ── Operate ──
  {
    id: "dashboard",
    label: "Dashboard",
    icon: LayoutGrid,
    navGroup: "sidebar",
    sidebarSection: "operate",
    shortcut: true,
    hostKinds: SHARED_HOST_KINDS,
    render: ({
      core,
      hostKind,
      navigate,
      onOpenAgentRun,
      onboardingAvailable,
      onOpenOnboarding,
    }) => (
      <DashboardPage
        core={core}
        onNavigate={navigate}
        onOpenAgentRun={onOpenAgentRun}
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
    sidebarSection: "operate",
    shortcut: true,
    hostKinds: SHARED_HOST_KINDS,
    render: ({ core }) => <ChatPage core={core} />,
  },
  {
    id: "approvals",
    label: "Approvals",
    icon: ShieldCheck,
    navGroup: "sidebar",
    sidebarSection: "operate",
    shortcut: true,
    hostKinds: SHARED_HOST_KINDS,
    render: ({ core }) => <ApprovalsPage core={core} />,
  },
  {
    id: "workboard",
    label: "Work",
    icon: SquareKanban,
    navGroup: "sidebar",
    sidebarSection: "operate",
    shortcut: true,
    hostKinds: SHARED_HOST_KINDS,
    render: ({ core, navigate }) => <WorkBoardPage core={core} onNavigate={navigate} />,
  },
  {
    id: "agents",
    label: "Agents",
    icon: Bot,
    navGroup: "sidebar",
    sidebarSection: "operate",
    shortcut: true,
    hostKinds: SHARED_HOST_KINDS,
    render: ({ core, agentsNavigationIntent, onAgentsNavigationIntentHandled }) => (
      <AgentsPage
        core={core}
        navigationIntent={agentsNavigationIntent}
        onNavigationIntentHandled={onAgentsNavigationIntentHandled}
      />
    ),
  },
  // ── Build ──
  {
    id: "extensions",
    label: "Extensions",
    icon: Blocks,
    navGroup: "sidebar",
    sidebarSection: "build",
    shortcut: true,
    hostKinds: SHARED_HOST_KINDS,
    render: ({ core }) => <ExtensionsPage core={core} />,
  },
  {
    id: "memory",
    label: "Memory",
    icon: Brain,
    navGroup: "sidebar",
    sidebarSection: "build",
    shortcut: true,
    hostKinds: SHARED_HOST_KINDS,
    render: ({ core }) => <MemoryPage core={core} />,
  },
  {
    id: "schedules",
    label: "Schedules",
    icon: CalendarClock,
    navGroup: "sidebar",
    sidebarSection: "build",
    shortcut: true,
    hostKinds: SHARED_HOST_KINDS,
    render: ({ core }) => <SchedulesPage core={core} />,
  },
  // ── System ──
  {
    id: "pairing",
    label: "Nodes",
    icon: Link2,
    navGroup: "sidebar",
    sidebarSection: "system",
    shortcut: false,
    hostKinds: SHARED_HOST_KINDS,
    render: ({ core }) => <PairingPage core={core} />,
  },
  {
    id: "desktop-environments",
    label: "Desktops",
    icon: Boxes,
    navGroup: "sidebar",
    sidebarSection: "system",
    shortcut: false,
    hostKinds: SHARED_HOST_KINDS,
    render: ({ core, mode }) => <DesktopEnvironmentsPage core={core} mode={mode} />,
  },
  {
    id: "configure",
    label: "Settings",
    icon: Settings,
    navGroup: "sidebar",
    sidebarSection: "system",
    shortcut: true,
    hostKinds: SHARED_HOST_KINDS,
    render: ({ core, mode, webAuthPersistence, initialConfigureTab, onConfigureTabChange }) => (
      <ConfigurePage
        core={core}
        mode={mode}
        webAuthPersistence={webAuthPersistence}
        initialTab={initialConfigureTab}
        onTabChange={onConfigureTabChange}
      />
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
