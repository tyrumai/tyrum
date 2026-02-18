import { useState } from "react";
import { Layout } from "./components/Layout.js";
import { Overview } from "./pages/Overview.js";
import { Gateway } from "./pages/Gateway.js";
import { Connection } from "./pages/Connection.js";
import { Permissions } from "./pages/Permissions.js";
import { Diagnostics } from "./pages/Diagnostics.js";
import { Logs } from "./pages/Logs.js";
import { ConsentModal } from "./components/ConsentModal.js";

const PAGES: Record<string, () => React.JSX.Element> = {
  overview: Overview,
  gateway: Gateway,
  connection: Connection,
  permissions: Permissions,
  diagnostics: Diagnostics,
  logs: Logs,
};

export function App() {
  const [page, setPage] = useState("overview");
  const PageComponent = PAGES[page] ?? Overview;

  return (
    <Layout currentPage={page} onNavigate={setPage}>
      <PageComponent />
      <ConsentModal />
    </Layout>
  );
}
