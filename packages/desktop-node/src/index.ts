export { parseDesktopNodeArgs, type DesktopNodeArgs } from "./cli/args.js";
export { runCli, VERSION } from "./cli/run-cli.js";

export {
  DesktopProvider,
  type ConfirmationFn,
  type DesktopProviderPermissions,
} from "./providers/desktop-provider.js";

export {
  type DesktopBackend,
  type ScreenCapture,
  MockDesktopBackend,
} from "./providers/backends/desktop-backend.js";
export { NutJsDesktopBackend } from "./providers/backends/nutjs-desktop-backend.js";
