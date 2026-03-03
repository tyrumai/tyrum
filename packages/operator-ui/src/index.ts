export type { OperatorCore } from "@tyrum/operator-core";

export type { OperatorUiAppProps, OperatorUiMode } from "./app.js";
export { OperatorUiApp } from "./app.js";

export type { HostKind, OperatorUiHostApi, OperatorUiHostProviderProps } from "./host/host-api.js";
export { OperatorUiHostProvider, useHostApi, useHostApiOptional } from "./host/host-api.js";

export type { DesktopApi } from "./desktop-api.js";
export { getDesktopApi } from "./desktop-api.js";

export type { ElevatedModeProviderProps } from "./elevated-mode.js";
export { ElevatedModeGate, ElevatedModeProvider } from "./elevated-mode.js";

export { cn } from "./lib/cn.js";

export type { ThemeMode } from "./hooks/use-theme.js";
export { ThemeProvider, useTheme } from "./hooks/use-theme.js";

export { useMediaQuery } from "./hooks/use-media-query.js";

export type { KeyboardShortcut } from "./hooks/use-keyboard-shortcut.js";
export { useKeyboardShortcut } from "./hooks/use-keyboard-shortcut.js";

export type { AppShellMode, AppShellProps } from "./components/layout/app-shell.js";
export { AppShell } from "./components/layout/app-shell.js";

export type {
  SidebarConnectionStatus,
  SidebarNavItem,
  SidebarProps,
} from "./components/layout/sidebar.js";
export { Sidebar } from "./components/layout/sidebar.js";

export type { MobileNavItem, MobileNavProps } from "./components/layout/mobile-nav.js";
export { MobileNav } from "./components/layout/mobile-nav.js";

export type { PageHeaderProps } from "./components/layout/page-header.js";
export { PageHeader } from "./components/layout/page-header.js";

export type { ButtonProps, ButtonSize, ButtonVariant } from "./components/ui/button.js";
export { Button } from "./components/ui/button.js";

export { Card, CardContent, CardFooter, CardHeader } from "./components/ui/card.js";

export type { BadgeProps, BadgeVariant } from "./components/ui/badge.js";
export { Badge } from "./components/ui/badge.js";

export type { InputProps } from "./components/ui/input.js";
export { Input } from "./components/ui/input.js";

export type { TextareaProps } from "./components/ui/textarea.js";
export { Textarea } from "./components/ui/textarea.js";

export type { JsonViewerProps } from "./components/ui/json-viewer.js";
export { JsonViewer } from "./components/ui/json-viewer.js";

export type { JsonTextareaProps } from "./components/ui/json-textarea.js";
export { JsonTextarea } from "./components/ui/json-textarea.js";

export type { LabelProps } from "./components/ui/label.js";
export { Label } from "./components/ui/label.js";

export type { AlertProps, AlertVariant } from "./components/ui/alert.js";
export { Alert } from "./components/ui/alert.js";

export type { ApiResultCardProps } from "./components/ui/api-result-card.js";
export { ApiResultCard } from "./components/ui/api-result-card.js";

export type { StatusDotProps, StatusDotVariant } from "./components/ui/status-dot.js";
export { StatusDot } from "./components/ui/status-dot.js";

export { Separator } from "./components/ui/separator.js";

export type { SpinnerProps } from "./components/ui/spinner.js";
export { Spinner } from "./components/ui/spinner.js";

export type { EmptyStateAction, EmptyStateProps } from "./components/ui/empty-state.js";
export { EmptyState } from "./components/ui/empty-state.js";

export type { SkeletonProps } from "./components/ui/skeleton.js";
export { Skeleton } from "./components/ui/skeleton.js";

export type { DialogFooterProps, DialogHeaderProps } from "./components/ui/dialog.js";
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "./components/ui/dialog.js";

export type { ConfirmDangerDialogProps } from "./components/ui/confirm-danger-dialog.js";
export { ConfirmDangerDialog } from "./components/ui/confirm-danger-dialog.js";

export { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs.js";

export { Checkbox } from "./components/ui/checkbox.js";

export { Switch } from "./components/ui/switch.js";

export { RadioGroup, RadioGroupItem } from "./components/ui/radio-group.js";

export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./components/ui/tooltip.js";

export { ScrollArea, ScrollBar } from "./components/ui/scroll-area.js";

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu.js";

export type { ErrorFallbackProps } from "./components/error/error-fallback.js";
export { ErrorFallback } from "./components/error/error-fallback.js";

export type {
  ErrorBoundaryFallback,
  ErrorBoundaryProps,
} from "./components/error/error-boundary.js";
export { ErrorBoundary } from "./components/error/error-boundary.js";

export type { ToastProviderProps } from "./components/toast/toast-provider.js";
export { ToastProvider } from "./components/toast/toast-provider.js";

export { toast } from "sonner";

export type { MemoryInspectorProps } from "./components/memory/memory-inspector.js";
export { MemoryInspector } from "./components/memory/memory-inspector.js";

// ── Page components (for direct rendering outside OperatorUiApp) ────────────
export type { DashboardPageProps } from "./components/pages/dashboard-page.js";
export { DashboardPage } from "./components/pages/dashboard-page.js";
export { ApprovalsPage } from "./components/pages/approvals-page.js";
export { RunsPage } from "./components/pages/runs-page.js";
export type { WorkBoardPageProps } from "./components/pages/workboard-page.js";
export { WorkBoardPage } from "./components/pages/workboard-page.js";
export { ConnectPage } from "./components/pages/connect-page.js";
export { PairingPage } from "./components/pages/pairing-page.js";
export { MemoryPage } from "./components/pages/memory-page.js";
export type { ConfigurePageProps } from "./components/pages/configure-page.js";
export { ConfigurePage } from "./components/pages/configure-page.js";
export { ChatPage } from "./components/pages/chat-page.js";
export { SettingsPage } from "./components/pages/settings-page.js";

// ── Hooks ───────────────────────────────────────────────────────────────────
export { useOperatorStore } from "./use-operator-store.js";
