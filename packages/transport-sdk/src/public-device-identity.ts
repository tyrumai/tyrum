export {
  DeviceIdentityError,
  buildConnectProofTranscript,
  computeDeviceIdFromPublicKeyDer,
  createDeviceIdentity,
  formatDeviceIdentityError,
  loadOrCreateDeviceIdentity,
  parseStoredDeviceIdentity,
  signProofWithPrivateKey,
} from "./device-identity.js";
export type { DeviceIdentity, DeviceIdentityStorage } from "./device-identity.js";
