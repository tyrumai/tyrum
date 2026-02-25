import { colors, fonts } from "../theme.js";

interface SidebarProps {
  currentPage: string;
  onNavigate: (page: string) => void;
}

const NAV_ITEMS = [
  { id: "overview", label: "Overview" },
  { id: "gateway", label: "Gateway" },
  { id: "connection", label: "Connection" },
  { id: "permissions", label: "Permissions" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "logs", label: "Logs" },
] as const;

const sidebarStyle: React.CSSProperties = {
  width: 200,
  minHeight: "100vh",
  background: colors.bgSubtle,
  color: colors.fgMuted,
  display: "flex",
  flexDirection: "column",
  padding: "16px 0",
  fontFamily: fonts.sans,
  borderRight: `1px solid ${colors.border}`,
};

const titleStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  padding: "0 16px 16px",
  borderBottom: `1px solid ${colors.border}`,
  marginBottom: 8,
  color: "#fff",
};

function navItemStyle(active: boolean): React.CSSProperties {
  return {
    padding: "10px 16px",
    cursor: "pointer",
    background: active ? colors.primaryDim : "transparent",
    borderLeft: active ? `3px solid ${colors.primary}` : "3px solid transparent",
    color: active ? "#fff" : colors.fgMuted,
    fontSize: 14,
    fontWeight: active ? 600 : 400,
    transition: "background 0.15s, color 0.15s",
    userSelect: "none" as const,
  };
}

export function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  return (
    <nav style={sidebarStyle}>
      <div style={titleStyle}>Tyrum</div>
      {NAV_ITEMS.map((item) => (
        <div
          key={item.id}
          style={navItemStyle(currentPage === item.id)}
          onClick={() => onNavigate(item.id)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") onNavigate(item.id);
          }}
        >
          {item.label}
        </div>
      ))}
    </nav>
  );
}
