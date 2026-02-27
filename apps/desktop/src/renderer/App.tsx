import { useCallback, useEffect, useState } from "react";
import { Layout } from "./components/Layout.js";
import { Overview } from "./pages/Overview.js";
import { Gateway } from "./pages/Gateway.js";
import { Connection } from "./pages/Connection.js";
import { Permissions } from "./pages/Permissions.js";
import { Diagnostics } from "./pages/Diagnostics.js";
import { Logs } from "./pages/Logs.js";
import { ConsentModal } from "./components/ConsentModal.js";
import { getPageIdForDeepLink } from "./deep-links.js";

type PageId = "overview" | "gateway" | "connection" | "permissions" | "diagnostics" | "logs";

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
  const handleNavigate = useCallback((nextPage: string): void => {
    if (VALID_PAGES.has(nextPage as PageId)) {
      setPage(nextPage as PageId);
    }
  }, []);

  useEffect(() => {
    const api = window.tyrumDesktop;
    if (!api) return;

    void api.getConfig().then((cfg) => {
      const config = cfg as Record<string, unknown>;
      const mode = config["mode"] === "remote" ? "remote" : "embedded";
      if (mode === "embedded") {
        setPage((current) => (current === "overview" ? "gateway" : current));
      }
    });
  }, []);

  useEffect(() => {
    const api = window.tyrumDesktop;
    if (!api?.onNavigationRequest) return;

    const unsubscribe = api.onNavigationRequest((req) => {
      if (req === null || typeof req !== "object" || Array.isArray(req)) {
        return;
      }
      const pageId = (req as Record<string, unknown>)["pageId"];
      if (typeof pageId !== "string") {
        return;
      }
      handleNavigate(pageId);
    });

    return unsubscribe;
  }, [handleNavigate]);

  useEffect(() => {
    const api = window.tyrumDesktop;
    if (!api?.consumeDeepLink || !api.onDeepLinkOpen) return;

    const handleDeepLink = (url: string): void => {
      handleNavigate(getPageIdForDeepLink(url));
    };

    void api.consumeDeepLink().then((url) => {
      if (typeof url === "string") {
        handleDeepLink(url);
      }
    });

    const unsubscribe = api.onDeepLinkOpen((url) => {
      handleDeepLink(url);
      void api.consumeDeepLink();
    });

    return unsubscribe;
  }, [handleNavigate]);

  return (
    <Layout currentPage={page} onNavigate={handleNavigate} fullBleed={page === "gateway"}>
      {page === "overview" && <Overview />}
      {page === "gateway" && <Gateway />}
      {page === "connection" && <Connection />}
      {page === "permissions" && <Permissions />}
      {page === "diagnostics" && <Diagnostics />}
      {page === "logs" && <Logs />}
      <ConsentModal />
    </Layout>
  );
}
