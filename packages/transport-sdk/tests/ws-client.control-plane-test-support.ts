import { registerControlPlaneErrorTests } from "./ws-client.control-plane-error-test-support.js";
import { registerControlPlaneRequestTests } from "./ws-client.control-plane-request-test-support.js";
import type { ControlPlaneFixture } from "./ws-client.control-plane-shared.js";

export function registerControlPlaneTests(fixture: ControlPlaneFixture): void {
  registerControlPlaneRequestTests(fixture);
  registerControlPlaneErrorTests(fixture);
}
