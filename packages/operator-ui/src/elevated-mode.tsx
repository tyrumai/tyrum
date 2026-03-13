export {
  ELEVATED_MODE_SCOPES,
  createPersistentElevatedModeController,
  type ElevatedModeController,
} from "./components/elevated-mode/elevated-mode-controller.js";
export type { ElevatedModeProviderProps } from "./components/elevated-mode/elevated-mode-provider.js";
export { ElevatedModeProvider } from "./components/elevated-mode/elevated-mode-provider.js";

export { ElevatedModeGate } from "./components/elevated-mode/elevated-mode-gate.js";

export {
  ELEVATED_MODE_SCOPES as ADMIN_ACCESS_SCOPES,
  createPersistentElevatedModeController as createAdminAccessController,
  type ElevatedModeController as AdminAccessController,
} from "./components/elevated-mode/elevated-mode-controller.js";
export type { ElevatedModeProviderProps as AdminAccessProviderProps } from "./components/elevated-mode/elevated-mode-provider.js";
export { ElevatedModeProvider as AdminAccessProvider } from "./components/elevated-mode/elevated-mode-provider.js";
export { ElevatedModeGate as AdminAccessGate } from "./components/elevated-mode/elevated-mode-gate.js";
