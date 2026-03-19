export { autoExecute } from "./capability.js";
export { createManagedNodeClientLifecycle } from "./managed-node-client.js";
export type * from "./capability.js";
export type { ManagedNodeClient, ManagedNodeClientLifecycle } from "./managed-node-client.js";
export {
  DeviceIdentityError,
  buildConnectProofTranscript,
  computeDeviceIdFromPublicKeyDer,
  createDeviceIdentity,
  formatDeviceIdentityError,
  loadOrCreateDeviceIdentity,
  parseStoredDeviceIdentity,
  signProofWithPrivateKey,
} from "@tyrum/transport-sdk";
export type { DeviceIdentity, DeviceIdentityStorage } from "@tyrum/transport-sdk";
export { VERSION } from "./version.js";
