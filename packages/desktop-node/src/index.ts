export { parseDesktopNodeArgs, type DesktopNodeArgs } from "./cli/args.js";
export { runCli, VERSION } from "./cli/run-cli.js";

export {
  DesktopProvider,
  type ConfirmationFn,
  type DesktopProviderPermissions,
} from "./providers/desktop-provider.js";

export type { OcrEngine, OcrMatch } from "./providers/ocr/types.js";
export { getTesseractOcrEngine } from "./providers/ocr/tesseract-engine.js";

export {
  type DesktopBackend,
  type ScreenCapture,
  MockDesktopBackend,
} from "./providers/backends/desktop-backend.js";
export { NutJsDesktopBackend } from "./providers/backends/nutjs-desktop-backend.js";

export {
  type DesktopA11yBackend,
  type DesktopA11ySnapshot,
  type DesktopA11yActResult,
} from "./providers/backends/desktop-a11y-backend.js";
export { AtSpiDesktopA11yBackend } from "./providers/backends/atspi-a11y-backend.js";
