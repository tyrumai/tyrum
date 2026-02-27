import { heading, colors, badge } from "../theme.js";

const containerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

const boardStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(7, minmax(160px, 1fr))",
  gap: 12,
  alignItems: "start",
};

const columnStyle: React.CSSProperties = {
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  background: colors.bgCard,
  padding: 12,
  minHeight: 120,
};

const columnTitleStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 8,
  fontSize: 13,
  fontWeight: 700,
  color: colors.fg,
};

export function WorkBoard() {
  const columns = ["Backlog", "Ready", "Doing", "Blocked", "Done", "Failed", "Cancelled"];

  return (
    <div style={containerStyle}>
      <h1 style={heading}>Work</h1>
      <div style={boardStyle}>
        {columns.map((label) => (
          <section key={label} style={columnStyle}>
            <div style={columnTitleStyle}>
              <span>{label}</span>
              <span style={{ ...badge, margin: 0 }}>0</span>
            </div>
            <div style={{ fontSize: 13, color: colors.fgMuted }}>No items</div>
          </section>
        ))}
      </div>
    </div>
  );
}

