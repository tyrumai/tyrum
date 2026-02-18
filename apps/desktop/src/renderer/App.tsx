import { useCallback, useEffect, useState } from "react";
import { Layout } from "./components/Layout.js";
import { Overview } from "./pages/Overview.js";
import { Gateway } from "./pages/Gateway.js";
import { Connection } from "./pages/Connection.js";
import { Permissions } from "./pages/Permissions.js";
import { Diagnostics } from "./pages/Diagnostics.js";
import { Logs } from "./pages/Logs.js";
import { ConsentModal } from "./components/ConsentModal.js";

type PageId =
  | "overview"
  | "gateway"
  | "connection"
  | "permissions"
  | "diagnostics"
  | "logs";

const VALID_PAGES = new Set<PageId>([
  "overview",
  "gateway",
  "connection",
  "permissions",
  "diagnostics",
  "logs",
]);

export function App() {
  const [page, setPage] = useState<PageId>("overview");
  const [launchOnboarding, setLaunchOnboarding] = useState(false);
  const handleOnboardingLaunchHandled = useCallback(() => {
    setLaunchOnboarding(false);
  }, []);
  const handleNavigate = (nextPage: string): void => {
    if (VALID_PAGES.has(nextPage as PageId)) {
      setPage(nextPage as PageId);
    }
  };

  useEffect(() => {
    const api = window.tyrumDesktop;
    if (!api) return;

    void Promise.all([api.getConfig(), api.getStartupState()]).then(
      ([cfg, startup]) => {
        const config = cfg as Record<string, unknown>;
        const mode = config["mode"] === "remote" ? "remote" : "embedded";
        const shouldLaunchOnboarding = startup?.launchOnboarding === true;
        if (mode === "embedded") {
          setPage("gateway");
          if (shouldLaunchOnboarding) {
            setLaunchOnboarding(true);
          }
        }
      },
    );

    const unsubscribe = api.onStatusChange((statusRaw) => {
      const status =
        statusRaw && typeof statusRaw === "object" && !Array.isArray(statusRaw)
          ? (statusRaw as Record<string, unknown>)
          : undefined;
      if (!status) return;
      const navigateTo =
        status["navigateTo"] &&
        typeof status["navigateTo"] === "object" &&
        !Array.isArray(status["navigateTo"])
          ? (status["navigateTo"] as Record<string, unknown>)
          : undefined;
      if (!navigateTo) return;

      const nextPage = navigateTo["page"];
      if (typeof nextPage === "string" && VALID_PAGES.has(nextPage as PageId)) {
        setPage(nextPage as PageId);
      }
    });

    return unsubscribe;
  }, []);

  return (
    <Layout currentPage={page} onNavigate={handleNavigate}>
      {page === "overview" && <Overview />}
      {page === "gateway" && (
        <Gateway
          launchOnboarding={launchOnboarding}
          onOnboardingLaunchHandled={handleOnboardingLaunchHandled}
        />
      )}
      {page === "connection" && <Connection />}
      {page === "permissions" && <Permissions />}
      {page === "diagnostics" && <Diagnostics />}
      {page === "logs" && <Logs />}
      <ConsentModal />
    </Layout>
  );
}
