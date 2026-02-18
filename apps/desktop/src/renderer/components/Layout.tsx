import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar.js";

interface LayoutProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  children: ReactNode;
}

const containerStyle: React.CSSProperties = {
  display: "flex",
  height: "100%",
  fontFamily: "system-ui, -apple-system, sans-serif",
  background: "#f5f5f7",
  color: "#1a1a2e",
};

const mainStyle: React.CSSProperties = {
  flex: 1,
  padding: 24,
  overflowY: "auto",
};

export function Layout({ currentPage, onNavigate, children }: LayoutProps) {
  return (
    <div style={containerStyle}>
      <Sidebar currentPage={currentPage} onNavigate={onNavigate} />
      <main style={mainStyle}>{children}</main>
    </div>
  );
}
