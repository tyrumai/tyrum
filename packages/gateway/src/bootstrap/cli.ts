import { configureCommander, normalizeCommanderError } from "@tyrum/cli-utils";
import { Command } from "commander";
import { installPluginFromDir } from "../modules/plugins/installer.js";
import type { LogLevel } from "../modules/observability/logger.js";
import { runToolRunnerFromStdio } from "../toolrunner.js";
import { VERSION } from "../version.js";
import {
  resolveDesktopTakeoverAdvertiseOrigin,
  resolveGatewayHome,
  type GatewayStartOptions,
} from "./config.js";
import { runTailscaleServeCommand, type TailscaleServeCliCommand } from "./cli-tailscale.js";
import { runGatewayCheck, runIssueDefaultTenantAdminToken } from "./cli-db-commands.js";
import { CLI_HELP_TEXT } from "./cli-help.js";
import {
  normalizeVersionSpecifier,
  parseUpdateChannel,
  runGatewayUpdate,
  type UpdateChannel,
} from "./cli-update.js";
import type { GatewayRole } from "./network.js";
import { main } from "./runtime.js";

export { resolveGatewayUpdateTarget } from "./cli-update.js";
type CliCommand =
  | ({
      kind: "start";
    } & GatewayStartOptions)
  | { kind: "check"; home?: string; db?: string; migrationsDir?: string }
  | { kind: "issue_default_tenant_admin_token"; home?: string; db?: string; migrationsDir?: string }
  | ({ kind: "tailscale_serve" } & TailscaleServeCliCommand)
  | { kind: "toolrunner"; home?: string; db?: string; migrationsDir?: string; payloadB64?: string }
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "update"; channel: UpdateChannel; version?: string }
  | { kind: "plugin_install"; source_dir: string; home?: string };
function printCliHelp(): void {
  console.log(CLI_HELP_TEXT);
}

function parsePortFlag(value: string): number {
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new Error(`--port must be an integer between 1 and 65535 (got '${value}')`);
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`--port must be an integer between 1 and 65535 (got '${value}')`);
  }
  return parsed;
}

function parseLogLevelFlag(value: string): LogLevel {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "debug" ||
    normalized === "info" ||
    normalized === "warn" ||
    normalized === "error" ||
    normalized === "silent"
  ) {
    return normalized;
  }
  throw new Error(`--log-level must be one of debug|info|warn|error|silent (got '${value}')`);
}

function parseNonEmptyStringFlag(flag: string, value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${flag} requires a non-empty value`);
  }
  return trimmed;
}

type CommonDbCliOptions = {
  home?: string;
  db?: string;
  migrationsDir?: string;
};

function parseOptionalNonEmptyStringFlag(
  flag: string,
  value: string | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return parseNonEmptyStringFlag(flag, value);
}

function parseCommonDbOptions(options: CommonDbCliOptions): CommonDbCliOptions {
  const parsed: CommonDbCliOptions = {};

  const home = parseOptionalNonEmptyStringFlag("--home", options.home);
  if (home !== undefined) {
    parsed.home = home;
  }

  const db = parseOptionalNonEmptyStringFlag("--db", options.db);
  if (db !== undefined) {
    parsed.db = db;
  }

  const migrationsDir = parseOptionalNonEmptyStringFlag("--migrations-dir", options.migrationsDir);
  if (migrationsDir !== undefined) {
    parsed.migrationsDir = migrationsDir;
  }

  return parsed;
}

function parseRoleFlag(value: string): GatewayRole {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "all" ||
    normalized === "edge" ||
    normalized === "worker" ||
    normalized === "scheduler" ||
    normalized === "desktop-runtime"
  ) {
    return normalized;
  }
  throw new Error(
    `--role must be one of all|edge|worker|scheduler|desktop-runtime (got '${value}')`,
  );
}

export function parseCliArgs(argv: readonly string[]): CliCommand {
  if (argv.length === 0) return { kind: "start" };

  const [first] = argv;
  if (!first) return { kind: "start" };

  if (argv.includes("-h") || argv.includes("--help")) return { kind: "help" };
  if (first === "-v" || first === "--version" || first === "version") return { kind: "version" };

  let result: CliCommand | undefined;
  const program = configureCommander(new Command().name("tyrum"));

  const addCommonDbOptions = <T extends Command>(command: T): T =>
    command.option("--home <dir>").option("--db <path>").option("--migrations-dir <dir>");

  const addStartCommand = (name: string, forcedRole?: GatewayRole): void => {
    addCommonDbOptions(program.command(name))
      .option("--host <host>")
      .option("--port <port>", "port", parsePortFlag)
      .option("--role <role>", "role", parseRoleFlag)
      .option("--desktop-takeover-advertise-origin <origin>")
      .option("--debug")
      .option("--log-level <level>", "log level", parseLogLevelFlag)
      .option("--trusted-proxies <list>")
      .option("--tls-ready")
      .option("--allow-insecure-http")
      .option("--enable-snapshot-import")
      .action(
        (options: {
          home?: string;
          db?: string;
          migrationsDir?: string;
          host?: string;
          port?: number;
          role?: GatewayRole;
          desktopTakeoverAdvertiseOrigin?: string;
          debug?: boolean;
          logLevel?: LogLevel;
          trustedProxies?: string;
          tlsReady?: boolean;
          allowInsecureHttp?: boolean;
          enableSnapshotImport?: boolean;
        }) => {
          const host = parseOptionalNonEmptyStringFlag("--host", options.host);
          const trustedProxies = parseOptionalNonEmptyStringFlag(
            "--trusted-proxies",
            options.trustedProxies,
          );
          const desktopTakeoverAdvertiseOrigin = resolveDesktopTakeoverAdvertiseOrigin(
            options.desktopTakeoverAdvertiseOrigin,
          );
          const role = options.role ?? forcedRole;

          result = {
            kind: "start",
            ...parseCommonDbOptions(options),
            ...(host !== undefined ? { host } : {}),
            ...(options.port !== undefined ? { port: options.port } : {}),
            ...(role !== undefined ? { role } : {}),
            ...(desktopTakeoverAdvertiseOrigin !== undefined
              ? { desktopTakeoverAdvertiseOrigin }
              : {}),
            ...(options.debug ? { debug: true } : {}),
            ...(options.logLevel !== undefined ? { logLevel: options.logLevel } : {}),
            ...(trustedProxies !== undefined ? { trustedProxies } : {}),
            ...(options.tlsReady ? { tlsReady: true } : {}),
            ...(options.allowInsecureHttp ? { allowInsecureHttp: true } : {}),
            ...(options.enableSnapshotImport ? { snapshotImportEnabled: true } : {}),
          };
        },
      );
  };

  addStartCommand("start");
  addStartCommand("all", "all");
  addStartCommand("edge", "edge");
  addStartCommand("worker", "worker");
  addStartCommand("scheduler", "scheduler");
  addStartCommand("desktop-runtime", "desktop-runtime");

  addCommonDbOptions(program.command("check")).action(
    (options: { home?: string; db?: string; migrationsDir?: string }) => {
      result = {
        kind: "check",
        ...parseCommonDbOptions(options),
      };
    },
  );

  addCommonDbOptions(program.command("toolrunner"))
    .option("--payload-b64 <value>")
    .action(
      (options: { home?: string; db?: string; migrationsDir?: string; payloadB64?: string }) => {
        const payloadB64 = parseOptionalNonEmptyStringFlag("--payload-b64", options.payloadB64);
        result = {
          kind: "toolrunner",
          ...parseCommonDbOptions(options),
          ...(payloadB64 !== undefined ? { payloadB64 } : {}),
        };
      },
    );

  const tokens = program.command("tokens").action(() => {
    throw new Error("tokens requires a subcommand (issue-default-tenant-admin)");
  });
  addCommonDbOptions(tokens.command("issue-default-tenant-admin")).action(
    (options: { home?: string; db?: string; migrationsDir?: string }) => {
      result = {
        kind: "issue_default_tenant_admin_token",
        ...parseCommonDbOptions(options),
      };
    },
  );

  const tailscale = program.command("tailscale").action(() => {
    throw new Error("tailscale requires a subcommand (serve)");
  });
  const tailscaleServe = tailscale.command("serve").action(() => {
    throw new Error("tailscale serve requires a subcommand (enable|status|disable)");
  });
  const addTailscaleServeCommand = (name: TailscaleServeCliCommand["action"]): void => {
    addCommonDbOptions(tailscaleServe.command(name))
      .option("--gateway-host <host>")
      .option("--gateway-port <port>", "gateway port", parsePortFlag)
      .option("--json")
      .action(
        (options: {
          home?: string;
          db?: string;
          migrationsDir?: string;
          gatewayHost?: string;
          gatewayPort?: number;
          json?: boolean;
        }) => {
          const gatewayHost = parseOptionalNonEmptyStringFlag(
            "--gateway-host",
            options.gatewayHost,
          );
          result = {
            kind: "tailscale_serve",
            action: name,
            ...parseCommonDbOptions(options),
            ...(gatewayHost !== undefined ? { gatewayHost } : {}),
            ...(options.gatewayPort !== undefined ? { gatewayPort: options.gatewayPort } : {}),
            ...(options.json ? { json: true } : {}),
          };
        },
      );
  };
  addTailscaleServeCommand("enable");
  addTailscaleServeCommand("status");
  addTailscaleServeCommand("disable");

  const plugin = program.command("plugin");
  plugin
    .command("install")
    .argument("<source_dir>")
    .option("--home <dir>")
    .action((sourceDir: string, options: { home?: string }) => {
      const home = parseOptionalNonEmptyStringFlag("--home", options.home);
      result = {
        kind: "plugin_install",
        source_dir: parseNonEmptyStringFlag("--source-dir", sourceDir),
        ...(home !== undefined ? { home } : {}),
      };
    });

  program
    .command("update")
    .option("--channel <channel>", "channel", parseUpdateChannel, "stable")
    .option("--version <version>", "version", normalizeVersionSpecifier)
    .action((options: { channel: UpdateChannel; version?: string }) => {
      result = {
        kind: "update",
        channel: options.channel,
        version: options.version,
      };
    });

  const normalizedArgv = first.startsWith("-") ? ["start", ...argv] : argv;
  try {
    program.parse(normalizedArgv, { from: "user" });
  } catch (error) {
    throw normalizeCommanderError(error);
  }

  if (!result) {
    throw new Error(`unknown command '${first}'`);
  }

  return result;
}

export async function runCli(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  let command: CliCommand;
  try {
    command = parseCliArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`error: ${message}`);
    printCliHelp();
    return 1;
  }

  if (command.kind === "help") {
    printCliHelp();
    return 0;
  }

  if (command.kind === "version") {
    console.log(VERSION);
    return 0;
  }

  if (command.kind === "check") {
    return await runGatewayCheck(command);
  }

  if (command.kind === "issue_default_tenant_admin_token") {
    return await runIssueDefaultTenantAdminToken(command);
  }

  if (command.kind === "tailscale_serve") {
    return await runTailscaleServeCommand(command);
  }

  if (command.kind === "toolrunner") {
    return runToolRunnerFromStdio({
      home: command.home,
      db: command.db,
      migrationsDir: command.migrationsDir,
      payloadB64: command.payloadB64,
    });
  }

  if (command.kind === "plugin_install") {
    const tyrumHome = resolveGatewayHome(command.home);
    try {
      const result = await installPluginFromDir({
        home: tyrumHome,
        sourceDir: command.source_dir,
      });
      console.log(`plugin.install: ok id=${result.plugin_id} dir=${result.plugin_dir}`);
      return 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`plugin.install: failed: ${message}`);
      return 1;
    }
  }

  if (command.kind === "update") {
    return runGatewayUpdate(command.channel, command.version);
  }

  await main({
    role: command.role,
    home: command.home,
    db: command.db,
    host: command.host,
    port: command.port,
    desktopTakeoverAdvertiseOrigin: command.desktopTakeoverAdvertiseOrigin,
    trustedProxies: command.trustedProxies,
    tlsReady: command.tlsReady,
    migrationsDir: command.migrationsDir,
    allowInsecureHttp: command.allowInsecureHttp,
    snapshotImportEnabled: command.snapshotImportEnabled,
  });
  return 0;
}
