export interface DesktopNodeArgs {
  wsUrl?: string;
  token?: string;
  tokenPath?: string;
  takeoverUrl?: string;
  label?: string;
  mode?: string;
  home?: string;
  help: boolean;
  version: boolean;
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseDesktopNodeArgs(argv: readonly string[]): DesktopNodeArgs {
  const result: DesktopNodeArgs = {
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "-h" || arg === "--help") {
      result.help = true;
      continue;
    }

    if (arg === "--version") {
      result.version = true;
      continue;
    }

    if (arg === "--ws-url") {
      result.wsUrl = requireValue(arg, argv[i + 1]);
      i += 1;
      continue;
    }

    if (arg === "--token") {
      result.token = requireValue(arg, argv[i + 1]);
      i += 1;
      continue;
    }

    if (arg === "--token-path") {
      result.tokenPath = requireValue(arg, argv[i + 1]);
      i += 1;
      continue;
    }

    if (arg === "--takeover-url") {
      result.takeoverUrl = requireValue(arg, argv[i + 1]);
      i += 1;
      continue;
    }

    if (arg === "--label") {
      result.label = requireValue(arg, argv[i + 1]);
      i += 1;
      continue;
    }

    if (arg === "--mode") {
      result.mode = requireValue(arg, argv[i + 1]);
      i += 1;
      continue;
    }

    if (arg === "--home") {
      result.home = requireValue(arg, argv[i + 1]);
      i += 1;
      continue;
    }

    throw new Error(`unknown argument: ${arg}`);
  }

  return result;
}
