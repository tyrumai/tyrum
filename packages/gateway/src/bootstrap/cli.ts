import { X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { installPluginFromDir } from "../modules/plugins/installer.js";
import { runToolRunnerFromStdio } from "../toolrunner.js";
import { VERSION } from "../version.js";
import { resolveGatewayHome, type GatewayStartOptions } from "./config.js";
import { runGatewayCheck, runIssueDefaultTenantAdminToken } from "./cli-db-commands.js";
import { CLI_HELP_TEXT } from "./cli-help.js";
import { runImportHome } from "./cli-import-home.js";
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
  | { kind: "plugin_install"; source_dir: string; home?: string }
  | {
      kind: "import_home";
      source_home: string;
      tenantId?: string;
      home?: string;
      db?: string;
      migrationsDir?: string;
    };
function printCliHelp(): void {
  console.log(CLI_HELP_TEXT);
}
type CommonDbFlags = { home?: string; db?: string; migrationsDir?: string };

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

function parseRoleFlag(value: string): GatewayRole {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "all" ||
    normalized === "edge" ||
    normalized === "worker" ||
    normalized === "scheduler"
  ) {
    return normalized;
  }
  throw new Error(`--role must be one of all|edge|worker|scheduler (got '${value}')`);
}

function parseCommonDbFlag(
  args: readonly string[],
  index: number,
  target: CommonDbFlags,
): { handled: boolean; nextIndex: number } {
  const arg = args[index];
  if (!arg) return { handled: false, nextIndex: index };

  if (arg === "--home") {
    const value = args[index + 1];
    if (!value) throw new Error("--home requires a value");
    target.home = value;
    return { handled: true, nextIndex: index + 1 };
  }

  if (arg === "--db") {
    const value = args[index + 1];
    if (!value) throw new Error("--db requires a value");
    target.db = value;
    return { handled: true, nextIndex: index + 1 };
  }

  if (arg === "--migrations-dir") {
    const value = args[index + 1];
    if (!value) throw new Error("--migrations-dir requires a value");
    target.migrationsDir = value;
    return { handled: true, nextIndex: index + 1 };
  }

  return { handled: false, nextIndex: index };
}

function parseStartFlags(
  args: readonly string[],
): Omit<CliCommand & { kind: "start" }, "kind"> | { kind: "help" } {
  const common: CommonDbFlags = {};
  let host: string | undefined;
  let port: number | undefined;
  let role: GatewayRole | undefined;
  let allowInsecureHttp: true | undefined;
  let engineApiEnabled: true | undefined;
  let snapshotImportEnabled: true | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;

    if (arg === "-h" || arg === "--help") return { kind: "help" };

    const commonFlag = parseCommonDbFlag(args, index, common);
    if (commonFlag.handled) {
      index = commonFlag.nextIndex;
      continue;
    }

    if (arg === "--host") {
      const value = args[index + 1];
      if (!value) throw new Error("--host requires a value");
      host = value;
      index += 1;
      continue;
    }

    if (arg === "--port") {
      const value = args[index + 1];
      if (!value) throw new Error("--port requires a value");
      port = parsePortFlag(value);
      index += 1;
      continue;
    }

    if (arg === "--role") {
      const value = args[index + 1];
      if (!value) throw new Error("--role requires a value");
      role = parseRoleFlag(value);
      index += 1;
      continue;
    }

    if (arg === "--allow-insecure-http") {
      allowInsecureHttp = true;
      continue;
    }

    if (arg === "--enable-engine-api") {
      engineApiEnabled = true;
      continue;
    }

    if (arg === "--enable-snapshot-import") {
      snapshotImportEnabled = true;
      continue;
    }

    throw new Error(`unsupported start argument '${arg}'`);
  }

  return {
    home: common.home,
    db: common.db,
    host,
    port,
    role,
    migrationsDir: common.migrationsDir,
    allowInsecureHttp,
    engineApiEnabled,
    snapshotImportEnabled,
  };
}

function parseDbFlags(
  args: readonly string[],
): { home?: string; db?: string; migrationsDir?: string } | { kind: "help" } {
  const common: CommonDbFlags = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;

    if (arg === "-h" || arg === "--help") return { kind: "help" };

    const commonFlag = parseCommonDbFlag(args, index, common);
    if (commonFlag.handled) {
      index = commonFlag.nextIndex;
      continue;
    }

    throw new Error(`unsupported argument '${arg}'`);
  }

  return { home: common.home, db: common.db, migrationsDir: common.migrationsDir };
}

function parseToolrunnerFlags(
  args: readonly string[],
): { home?: string; db?: string; migrationsDir?: string; payloadB64?: string } | { kind: "help" } {
  const common: CommonDbFlags = {};
  let payloadB64: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;

    if (arg === "-h" || arg === "--help") return { kind: "help" };

    const commonFlag = parseCommonDbFlag(args, index, common);
    if (commonFlag.handled) {
      index = commonFlag.nextIndex;
      continue;
    }

    if (arg === "--payload-b64") {
      const value = args[index + 1];
      if (!value) throw new Error("--payload-b64 requires a value");
      payloadB64 = value;
      index += 1;
      continue;
    }

    throw new Error(`unsupported argument '${arg}'`);
  }

  return {
    home: common.home,
    db: common.db,
    migrationsDir: common.migrationsDir,
    payloadB64,
  };
}

export function parseCliArgs(argv: readonly string[]): CliCommand {
  if (argv.length === 0) return { kind: "start" };

  const [first, ...rest] = argv;
  if (!first) return { kind: "start" };

  if (first === "-h" || first === "--help") return { kind: "help" };
  if (first === "-v" || first === "--version" || first === "version") return { kind: "version" };

  if (first === "start") {
    const flags = parseStartFlags(rest);
    if ("kind" in flags) return flags;
    return { kind: "start", ...flags };
  }

  if (first === "all" || first === "edge" || first === "worker" || first === "scheduler") {
    const flags = parseStartFlags(rest);
    if ("kind" in flags) return flags;
    return { kind: "start", ...flags, role: flags.role ?? first };
  }

  if (first === "check") {
    const flags = parseDbFlags(rest);
    if ("kind" in flags) return flags;
    return { kind: "check", ...flags };
  }

  if (first === "tokens") {
    const [subcommand, ...args] = rest;
    if (!subcommand) throw new Error("tokens requires a subcommand (issue-default-tenant-admin)");
    if (subcommand === "-h" || subcommand === "--help") return { kind: "help" };
    if (subcommand !== "issue-default-tenant-admin") {
      throw new Error(`unknown tokens command '${subcommand}'`);
    }

    const flags = parseDbFlags(args);
    if ("kind" in flags) return flags;
    return { kind: "issue_default_tenant_admin_token", ...flags };
  }

  if (first === "toolrunner") {
    const flags = parseToolrunnerFlags(rest);
    if ("kind" in flags) return flags;
    return { kind: "toolrunner", ...flags };
  }

  if (first === "tls") {
    const [subcommand, ...args] = rest;
    if (!subcommand) throw new Error("tls requires a subcommand (fingerprint)");
    if (subcommand === "-h" || subcommand === "--help") return { kind: "help" };
    if (subcommand !== "fingerprint") throw new Error(`unknown tls command '${subcommand}'`);

    const flags = parseDbFlags(args);
    if ("kind" in flags) return flags;
    if (flags.db || flags.migrationsDir) {
      throw new Error("tls fingerprint only supports --home");
    }
    return { kind: "tls_fingerprint", home: flags.home };
  }

  if (first === "plugin") {
    const [subcommand, ...args] = rest;
    if (subcommand === "-h" || subcommand === "--help") return { kind: "help" };
    if (subcommand !== "install") {
      throw new Error(`unknown plugin command '${subcommand ?? ""}'`);
    }

    let sourceDir: string | undefined;
    let home: string | undefined;

    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (!arg) continue;

      if (arg === "--home") {
        const value = args[index + 1];
        if (!value) {
          throw new Error("--home requires a value");
        }
        home = value;
        index += 1;
        continue;
      }

      if (arg === "-h" || arg === "--help") {
        return { kind: "help" };
      }

      if (arg.startsWith("-")) {
        throw new Error(`unsupported plugin install argument '${arg}'`);
      }

      if (!sourceDir) {
        sourceDir = arg;
        continue;
      }

      throw new Error(`unexpected plugin install argument '${arg}'`);
    }

    if (!sourceDir) {
      throw new Error("plugin install requires a source directory");
    }

    return { kind: "plugin_install", source_dir: sourceDir, home };
  }

  if (first === "import-home") {
    const common: CommonDbFlags = {};
    let sourceHome: string | undefined;
    let tenantId: string | undefined;

    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index];
      if (!arg) continue;

      if (arg === "-h" || arg === "--help") {
        return { kind: "help" };
      }

      const commonFlag = parseCommonDbFlag(rest, index, common);
      if (commonFlag.handled) {
        index = commonFlag.nextIndex;
        continue;
      }

      if (arg === "--tenant-id") {
        const value = rest[index + 1];
        if (!value) throw new Error("--tenant-id requires a value");
        tenantId = value.trim();
        index += 1;
        continue;
      }

      if (arg.startsWith("-")) {
        throw new Error(`unsupported import-home argument '${arg}'`);
      }

      if (!sourceHome) {
        sourceHome = arg;
        continue;
      }

      throw new Error(`unexpected import-home argument '${arg}'`);
    }

    if (!sourceHome) {
      throw new Error("import-home requires a source home directory");
    }

    return {
      kind: "import_home",
      source_home: sourceHome,
      tenantId,
      home: common.home,
      db: common.db,
      migrationsDir: common.migrationsDir,
    };
  }

  if (first !== "update") throw new Error(`unknown command '${first}'`);

  let channel: UpdateChannel = "stable";
  let version: string | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg) continue;

    if (arg === "--channel") {
      const value = rest[index + 1];
      if (!value) {
        throw new Error("--channel requires a value");
      }
      channel = parseUpdateChannel(value);
      index += 1;
      continue;
    }

    if (arg === "--version") {
      const value = rest[index + 1];
      if (!value) {
        throw new Error("--version requires a value");
      }
      version = normalizeVersionSpecifier(value);
      index += 1;
      continue;
    }

    if (arg === "-h" || arg === "--help") {
      return { kind: "help" };
    }

    throw new Error(`unsupported update argument '${arg}'`);
  }

  return { kind: "update", channel, version };
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

  if (command.kind === "import_home") {
    return await runImportHome(command);
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
    migrationsDir: command.migrationsDir,
    allowInsecureHttp: command.allowInsecureHttp,
    engineApiEnabled: command.engineApiEnabled,
    snapshotImportEnabled: command.snapshotImportEnabled,
  });
  return 0;
}
