import { registerHttpClientOpsAdminTests } from "./http-client.test-ops-admin-support.js";
import { registerHttpClientOpsCoreTests } from "./http-client.test-ops-core-support.js";

export function registerHttpClientOpsTests(): void {
  registerHttpClientOpsCoreTests();
  registerHttpClientOpsAdminTests();
}
