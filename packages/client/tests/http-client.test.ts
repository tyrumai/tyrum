import { describe } from "vitest";
import { registerHttpClientAuditTests } from "./http-client.test-audit-support.js";
import { registerHttpClientAuthTests } from "./http-client.test-auth-support.js";
import { registerHttpClientCoreTests } from "./http-client.test-core-support.js";
import { registerHttpClientManagedAgentTests } from "./http-client.test-managed-agents-support.js";
import { registerHttpClientOpsTests } from "./http-client.test-ops-support.js";
import { registerHttpClientTokenTests } from "./http-client.test-token-support.js";
import { registerHttpClientPolicyTests } from "./http-client.test-policy-support.js";

describe("createTyrumHttpClient", () => {
  registerHttpClientCoreTests();
  registerHttpClientTokenTests();
  registerHttpClientAuthTests();
  registerHttpClientAuditTests();
  registerHttpClientPolicyTests();
  registerHttpClientOpsTests();
  registerHttpClientManagedAgentTests();
});
