import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar.js";
import { colors, fonts } from "../theme.js";

interface LayoutProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  fullBleed?: boolean;
  children: ReactNode;
}

const containerStyle: React.CSSProperties = {
  display: "flex",
  height: "100%",
  fontFamily: fonts.sans,
  background: colors.bg,
  color: colors.fg,
};

const mainStyle: React.CSSProperties = {
  flex: 1,
  padding: 24,
  overflowY: "auto",
};

export function Layout({ currentPage, onNavigate, fullBleed = false, children }: LayoutProps) {
  const computedMainStyle: React.CSSProperties = fullBleed
    ? { ...mainStyle, padding: 0, overflow: "hidden" }
    : mainStyle;

  return (
    <div style={containerStyle}>
      <Sidebar currentPage={currentPage} onNavigate={onNavigate} />
      <main style={computedMainStyle}>{children}</main>
    </div>
  );
}
