export interface DesktopThemeState {
  colorScheme: "light" | "dark";
  highContrast: boolean;
  inverted: boolean;
  source: "system" | "light" | "dark";
}
