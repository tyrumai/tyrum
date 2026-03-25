import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { GatewayBinSource } from "./gateway-bin-path.js";
import type { DesktopSubprocessLaunchSpec } from "./desktop-subprocess.js";

export interface GatewayProcessOptions {
  gatewayBin: string;
  gatewayBinSource?: GatewayBinSource;
  dbPath: string;
  home?: string;
}

function inferHomeFromDbPath(dbPath: string): string | undefined {
  if (!dbPath || dbPath.includes("://")) return undefined;
  try {
    return dirname(dbPath);
  } catch {
    return undefined;
  }
}

function resolveGatewayMigrationsDir(gatewayBin: string): string | undefined {
  const gatewayDir = dirname(gatewayBin);
  const alongsideGateway = join(gatewayDir, "migrations");
  if (existsSync(alongsideGateway)) {
    const sqliteDir = join(alongsideGateway, "sqlite");
    return existsSync(sqliteDir) ? sqliteDir : alongsideGateway;
  }

  const monorepoMigrations = join(gatewayDir, "../migrations");
  if (existsSync(monorepoMigrations)) {
    const sqliteDir = join(monorepoMigrations, "sqlite");
    return existsSync(sqliteDir) ? sqliteDir : monorepoMigrations;
  }

  return undefined;
}

function isElectronRuntime(versions: NodeJS.ProcessVersions = process.versions): boolean {
  return typeof versions.electron === "string" && versions.electron.length > 0;
}

function isMonorepoGatewayBundlePath(gatewayBin: string): boolean {
  return gatewayBin.replaceAll("\\", "/").includes("/packages/gateway/dist/");
}

function resolveNodeCommand(env: NodeJS.ProcessEnv = process.env): string {
  const preferredNode =
    env["TYRUM_DESKTOP_NODE_EXEC_PATH"]?.trim() ||
    env["npm_node_execpath"]?.trim() ||
    env["VOLTA_NODE"]?.trim();
  return preferredNode || "node";
}

export function buildGatewayDbArgs(opts: GatewayProcessOptions): string[] {
  const home = opts.home ?? inferHomeFromDbPath(opts.dbPath);
  const args: string[] = [];
  if (home) args.push("--home", home);
  args.push("--db", opts.dbPath);

  const migrationsDir = resolveGatewayMigrationsDir(opts.gatewayBin);
  if (migrationsDir) {
    args.push("--migrations-dir", migrationsDir);
  }

  return args;
}

export function resolveGatewayLaunchSpec(options: {
  gatewayBin: string;
  gatewayBinSource?: GatewayBinSource;
  processExecPath?: string;
  versions?: NodeJS.ProcessVersions;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): DesktopSubprocessLaunchSpec {
  const processExecPath = options.processExecPath ?? process.execPath;
  const versions = options.versions ?? process.versions;
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;

  if (!isElectronRuntime(versions)) {
    return { kind: "node", command: processExecPath, args: [], env: {} };
  }

  if (options.gatewayBinSource === "monorepo") {
    return { kind: "node", command: resolveNodeCommand(env), args: [], env: {} };
  }

  if (options.gatewayBinSource === "staged") {
    return {
      kind: "utility",
      modulePath: options.gatewayBin,
      args: [],
      env: {},
      serviceName: "Tyrum Embedded Gateway",
      allowLoadingUnsignedLibraries: true,
    };
  }

  if (options.gatewayBinSource === "packaged" && platform === "darwin") {
    return {
      kind: "node",
      command: processExecPath,
      args: [],
      env: {
        ELECTRON_RUN_AS_NODE: "1",
      },
    };
  }

  if (!options.gatewayBinSource && isMonorepoGatewayBundlePath(options.gatewayBin)) {
    return { kind: "node", command: resolveNodeCommand(env), args: [], env: {} };
  }

  return {
    kind: "utility",
    modulePath: options.gatewayBin,
    args: [],
    env: {},
    serviceName: "Tyrum Embedded Gateway",
    allowLoadingUnsignedLibraries: true,
  };
}

export function applyGatewayCliArgs(
  launch: DesktopSubprocessLaunchSpec,
  gatewayBin: string,
  cliArgs: string[],
): DesktopSubprocessLaunchSpec {
  if (launch.kind === "node") {
    return {
      ...launch,
      args: [gatewayBin, ...cliArgs],
    };
  }

  return {
    ...launch,
    args: cliArgs,
  };
}
