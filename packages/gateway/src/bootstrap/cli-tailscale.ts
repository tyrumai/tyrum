import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DEFAULT_PUBLIC_BASE_URL, DeploymentConfig } from "@tyrum/contracts";
import { TailscaleServeService, type TailscaleServeStatus } from "@tyrum/runtime-node-control";
import { DeploymentConfigDal } from "../modules/config/deployment-config-dal.js";
import type { SqlDb } from "../statestore/types.js";
import {
  ensureDatabaseDirectory,
  openGatewayDb,
  resolveGatewayDbPath,
  resolveGatewayHome,
  resolveGatewayMigrationsDir,
} from "./config.js";
import { isLoopbackOnlyHost } from "./network.js";

const execFileAsync = promisify(execFile);

export type TailscaleServeCliCommand = {
  action: "enable" | "status" | "disable";
  home?: string;
  db?: string;
  migrationsDir?: string;
  gatewayHost?: string;
  gatewayPort?: number;
  json?: boolean;
};

async function runExec(
  file: string,
  args: readonly string[],
): Promise<{ status: number; stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(file, [...args], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    return { status: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failed = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: string | number;
    };
    if (failed.code === "ENOENT") throw failed;
    return {
      status: typeof failed.code === "number" ? failed.code : 1,
      stdout: typeof failed.stdout === "string" ? failed.stdout : "",
      stderr: typeof failed.stderr === "string" ? failed.stderr : failed.message,
    };
  }
}

async function closeCommandDb(db: SqlDb | undefined): Promise<void> {
  await db?.close().catch(() => {});
}

async function ensureDeploymentConfigDal(cmd: TailscaleServeCliCommand): Promise<{
  db: SqlDb;
  home: string;
  dal: DeploymentConfigDal;
}> {
  const home = resolveGatewayHome(cmd.home);
  const dbPath = resolveGatewayDbPath(home, cmd.db);
  const migrationsDir = resolveGatewayMigrationsDir(dbPath, cmd.migrationsDir);
  ensureDatabaseDirectory(dbPath);
  const db = await openGatewayDb({ dbPath, migrationsDir });
  return { db, home, dal: new DeploymentConfigDal(db) };
}

function printStatus(status: TailscaleServeStatus): void {
  console.log(`tailscale backend: ${status.backendState}`);
  console.log(`gateway target: ${status.gatewayTarget}`);
  console.log(`gateway reachable: ${status.gatewayReachable ? "yes" : "no"}`);
  if (status.gatewayReachabilityReason) {
    console.log(`gateway reachability reason: ${status.gatewayReachabilityReason}`);
  }
  if (status.publicUrl) console.log(`public url: ${status.publicUrl}`);
  console.log(`ownership: ${status.ownership}`);
  console.log(`publicBaseUrl: ${status.currentPublicBaseUrl}`);
  if (status.reason) console.log(`reason: ${status.reason}`);
  console.log(`admin: ${status.adminUrl}`);
}

export async function runTailscaleServeCommand(cmd: TailscaleServeCliCommand): Promise<number> {
  let db: SqlDb | undefined;
  try {
    const resolved = await ensureDeploymentConfigDal(cmd);
    db = resolved.db;
    const host = cmd.gatewayHost?.trim() || "127.0.0.1";
    const port = cmd.gatewayPort ?? 8788;
    if (cmd.action === "enable" && !isLoopbackOnlyHost(host)) {
      throw new Error("--gateway-host must resolve to a loopback address for tailscale serve");
    }

    const service = new TailscaleServeService(
      resolved.home,
      { host, port },
      {
        exec: runExec,
        getPublicBaseUrl: async () =>
          (
            await resolved.dal.ensureSeeded({
              defaultConfig: DeploymentConfig.parse({
                server: { publicBaseUrl: DEFAULT_PUBLIC_BASE_URL },
              }),
              createdBy: { kind: "bootstrap.tailscale" },
              reason: "seed",
            })
          ).config.server.publicBaseUrl,
        setPublicBaseUrl: async (next) => {
          const latest = await resolved.dal.ensureSeeded({
            defaultConfig: DeploymentConfig.parse({
              server: { publicBaseUrl: DEFAULT_PUBLIC_BASE_URL },
            }),
            createdBy: { kind: "bootstrap.tailscale" },
            reason: "seed",
          });
          await resolved.dal.set({
            config: DeploymentConfig.parse({
              ...latest.config,
              server: { ...latest.config.server, publicBaseUrl: next },
            }),
            createdBy: { kind: "bootstrap.tailscale" },
            reason: `tailscale_serve.${cmd.action}`,
          });
        },
      },
    );

    const status =
      cmd.action === "enable"
        ? await service.enable()
        : cmd.action === "disable"
          ? await service.disable()
          : await service.status();
    if (cmd.json) {
      console.log(JSON.stringify({ ok: true, action: cmd.action, status }, null, 2));
    } else {
      console.log(`tailscale serve ${cmd.action}: ok`);
      printStatus(status);
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (cmd.json) {
      console.log(JSON.stringify({ ok: false, action: cmd.action, error: message }, null, 2));
    } else {
      console.error(`tailscale serve ${cmd.action}: failed: ${message}`);
    }
    return 1;
  } finally {
    await closeCommandDb(db);
  }
}
