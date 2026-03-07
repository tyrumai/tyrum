import { spawn } from "node:child_process";

export type UpdateChannel = "stable" | "beta" | "dev";

const UPDATE_CHANNEL_TAG: Record<UpdateChannel, string> = {
  stable: "latest",
  beta: "next",
  dev: "dev",
};

function npmExecutableForPlatform(platform: NodeJS.Platform): string {
  return platform === "win32" ? "npm.cmd" : "npm";
}

export function resolveGatewayUpdateTarget(channel: UpdateChannel, version?: string): string {
  if (version && version.length > 0) return version;
  return UPDATE_CHANNEL_TAG[channel];
}

export function parseUpdateChannel(raw: string): UpdateChannel {
  if (raw === "stable" || raw === "beta" || raw === "dev") {
    return raw;
  }
  throw new Error(`invalid update channel '${raw}' (expected stable, beta, or dev)`);
}

export function normalizeVersionSpecifier(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("update --version requires a non-empty value");
  }

  const normalized = trimmed.startsWith("v") && trimmed.length > 1 ? trimmed.slice(1) : trimmed;
  if (!/^[0-9A-Za-z][0-9A-Za-z.-]*$/.test(normalized)) {
    throw new Error(
      `invalid version '${raw}'. Use release versions like 2026.2.18 or 2026.2.18-beta.1`,
    );
  }
  return normalized;
}

export async function runGatewayUpdate(channel: UpdateChannel, version?: string): Promise<number> {
  const target = resolveGatewayUpdateTarget(channel, version);
  const packageSpec = `@tyrum/gateway@${target}`;
  const npmCmd = npmExecutableForPlatform(process.platform);

  console.log(`Updating ${packageSpec} ...`);

  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(npmCmd, ["install", "-g", packageSpec], {
      stdio: "inherit",
    });

    child.once("error", (error) => {
      reject(error);
    });

    child.once("exit", (code, signal) => {
      if (signal) {
        console.error(`Update process terminated by signal: ${signal}`);
        resolve(1);
        return;
      }
      resolve(code ?? 1);
    });
  });

  if (exitCode === 0) {
    console.log("Update completed.");
    return 0;
  }

  console.error(`Update failed with exit code ${exitCode}.`);
  return exitCode;
}
