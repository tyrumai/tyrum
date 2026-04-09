import { configureCommander, normalizeCommanderError } from "@tyrum/cli-utils";
import { Command } from "commander";

export interface DesktopNodeArgs {
  wsUrl?: string;
  token?: string;
  tokenPath?: string;
  tlsFingerprint256?: string;
  takeoverUrl?: string;
  label?: string;
  mode?: string;
  home?: string;
  browser?: boolean;
  browserHeadless?: boolean;
  help: boolean;
  version: boolean;
}

export function parseDesktopNodeArgs(argv: readonly string[]): DesktopNodeArgs {
  const result: DesktopNodeArgs = {
    help: false,
    version: false,
  };

  if (argv.includes("-h") || argv.includes("--help")) {
    return { ...result, help: true };
  }
  if (argv.includes("--version")) {
    return { ...result, version: true };
  }

  const program = configureCommander(new Command().name("tyrum-desktop-node"))
    .option("--ws-url <url>")
    .option("--token <token>")
    .option("--token-path <path>")
    .option("--tls-fingerprint256 <hex>")
    .option("--takeover-url <url>")
    .option("--label <label>")
    .option("--mode <mode>")
    .option("--home <dir>")
    .option("--browser")
    .option("--browser-headless");

  try {
    program.parse(argv, { from: "user" });
  } catch (error) {
    throw normalizeCommanderError(error);
  }

  const options = program.opts<{
    wsUrl?: string;
    token?: string;
    tokenPath?: string;
    tlsFingerprint256?: string;
    takeoverUrl?: string;
    label?: string;
    mode?: string;
    home?: string;
    browser?: boolean;
    browserHeadless?: boolean;
  }>();

  return {
    ...result,
    wsUrl: options.wsUrl,
    token: options.token,
    tokenPath: options.tokenPath,
    tlsFingerprint256: options.tlsFingerprint256,
    takeoverUrl: options.takeoverUrl,
    label: options.label,
    mode: options.mode,
    home: options.home,
    browser: options.browser,
    browserHeadless: options.browserHeadless,
  };
}
