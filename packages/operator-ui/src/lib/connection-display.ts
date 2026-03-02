import type { StatusDotVariant } from "../components/ui/status-dot.js";

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export type ConnectionDisplay = {
  variant: StatusDotVariant;
  pulse: boolean;
  label: "Disconnected" | "Connecting" | "Connected";
};

export function getConnectionDisplay(status: ConnectionStatus): ConnectionDisplay {
  if (status === "connected") return { variant: "success", pulse: false, label: "Connected" };
  if (status === "connecting") return { variant: "warning", pulse: true, label: "Connecting" };
  return { variant: "danger", pulse: false, label: "Disconnected" };
}
