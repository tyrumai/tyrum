import { registerHttpClientAgentExposureTests } from "./http-client.test-agent-exposure-support.js";
import { registerHttpClientOpsAdminTests } from "./http-client.test-ops-admin-support.js";
import { registerHttpClientOpsCoreTests } from "./http-client.test-ops-core-support.js";

export function registerHttpClientOpsTests(): void {
  registerHttpClientAgentExposureTests();
  registerHttpClientOpsCoreTests();
  registerHttpClientOpsAdminTests();
}
