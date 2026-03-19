import {
  createNodeFileDeviceIdentityStorage,
  formatDeviceIdentityError,
  loadOrCreateDeviceIdentity,
} from "@tyrum/transport-sdk/node";

import type { CliCommand } from "../cli-command.js";
import { resolveOperatorDeviceIdentityPath } from "../operator-paths.js";

export async function handleIdentityShow(
  _command: Extract<CliCommand, { kind: "identity_show" }>,
  home: string,
): Promise<number> {
  const identityPath = resolveOperatorDeviceIdentityPath(home);
  const storage = createNodeFileDeviceIdentityStorage(identityPath);
  try {
    const identity = await storage.load();
    if (!identity) {
      console.error(`identity: not found: run 'tyrum-cli identity init' path=${identityPath}`);
      return 1;
    }
    console.log(`identity: ok device_id=${identity.deviceId} path=${identityPath}`);
    return 0;
  } catch (error) {
    console.error(`identity: failed: ${formatDeviceIdentityError(error)}`);
    return 1;
  }
}

export async function handleIdentityInit(
  _command: Extract<CliCommand, { kind: "identity_init" }>,
  home: string,
): Promise<number> {
  const identityPath = resolveOperatorDeviceIdentityPath(home);
  const storage = createNodeFileDeviceIdentityStorage(identityPath);
  try {
    const identity = await loadOrCreateDeviceIdentity(storage);
    console.log(`identity: ok device_id=${identity.deviceId} path=${identityPath}`);
    return 0;
  } catch (error) {
    console.error(`identity: failed: ${formatDeviceIdentityError(error)}`);
    return 1;
  }
}
