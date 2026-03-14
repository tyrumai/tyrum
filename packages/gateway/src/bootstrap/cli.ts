import { X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { configureCommander, normalizeCommanderError } from "@tyrum/cli-utils";
import { Command } from "commander";
import { installPluginFromDir } from "../modules/plugins/installer.js";
import { runToolRunnerFromStdio } from "../toolrunner.js";
import { VERSION } from "../version.js";
import { resolveGatewayHome, type GatewayStartOptions } from "./config.js";
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
  | { kind: "tls_fingerprint"; home?: string }
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
      .option("--trusted-proxies <list>")
      .option("--tls-ready")
      .option("--tls-self-signed")
      .option("--allow-insecure-http")
      .option("--enable-engine-api")
      .option("--enable-snapshot-import")
      .action(
        (options: {
          home?: string;
          db?: string;
          migrationsDir?: string;
          host?: string;
          port?: number;
          role?: GatewayRole;
          trustedProxies?: string;
          tlsReady?: boolean;
          tlsSelfSigned?: boolean;
          allowInsecureHttp?: boolean;
          enableEngineApi?: boolean;
          enableSnapshotImport?: boolean;
        }) => {
          const host = parseOptionalNonEmptyStringFlag("--host", options.host);
          const trustedProxies = parseOptionalNonEmptyStringFlag(
            "--trusted-proxies",
            options.trustedProxies,
          );
          const role = options.role ?? forcedRole;

          result = {
            kind: "start",
            ...parseCommonDbOptions(options),
            ...(host !== undefined ? { host } : {}),
            ...(options.port !== undefined ? { port: options.port } : {}),
            ...(role !== undefined ? { role } : {}),
            ...(trustedProxies !== undefined ? { trustedProxies } : {}),
            ...(options.tlsReady ? { tlsReady: true } : {}),
            ...(options.tlsSelfSigned ? { tlsSelfSigned: true } : {}),
            ...(options.allowInsecureHttp ? { allowInsecureHttp: true } : {}),
            ...(options.enableEngineApi ? { engineApiEnabled: true } : {}),
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

  const tls = program.command("tls").action(() => {
    throw new Error("tls requires a subcommand (fingerprint)");
  });
  tls
    .command("fingerprint")
    .option("--home <dir>")
    .action((options: { home?: string }) => {
      const home = parseOptionalNonEmptyStringFlag("--home", options.home);
      result = {
        kind: "tls_fingerprint",
        ...(home !== undefined ? { home } : {}),
      };
    });

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

async function runTlsFingerprint(
  cmd: Extract<CliCommand, { kind: "tls_fingerprint" }>,
): Promise<number> {
  const tyrumHome = resolveGatewayHome(cmd.home);
  const certPath = join(tyrumHome, "tls", "cert.pem");

  try {
    const certPem = await readFile(certPath, "utf-8");
    const fingerprint256 = new X509Certificate(certPem).fingerprint256;
    console.log(`fingerprint256=${fingerprint256}`);
    console.log(`cert_path=${certPath}`);
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `tls fingerprint: failed: ${message}. ` +
        `Expected a certificate at ${certPath}. ` +
        "Start the gateway with self-signed TLS enabled to generate one.",
    );
    return 1;
  }
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

  if (command.kind === "tls_fingerprint") {
    return await runTlsFingerprint(command);
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
    trustedProxies: command.trustedProxies,
    tlsReady: command.tlsReady,
    tlsSelfSigned: command.tlsSelfSigned,
    migrationsDir: command.migrationsDir,
    allowInsecureHttp: command.allowInsecureHttp,
    engineApiEnabled: command.engineApiEnabled,
    snapshotImportEnabled: command.snapshotImportEnabled,
  });
  return 0;
}
