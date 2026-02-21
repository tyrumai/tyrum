import { BrowserRouter, Routes, Route, Link, Navigate } from "react-router";
import { Dashboard } from "./pages/Dashboard.js";

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "1rem" }}>
      <nav style={{ borderBottom: "1px solid #e5e7eb", paddingBottom: "0.5rem", marginBottom: "1rem" }}>
        <Link to="/app" style={{ marginRight: "1rem", textDecoration: "none", fontWeight: "bold" }}>
          Tyrum
        </Link>
      </nav>
      <main>{children}</main>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/app" element={<Dashboard />} />
          <Route path="/app/*" element={<Navigate to="/app" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
