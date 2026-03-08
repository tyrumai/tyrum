import { describe } from "vitest";
import { registerHttpClientAuthTests } from "./http-client.test-auth-support.js";
import { registerHttpClientCoreTests } from "./http-client.test-core-support.js";
import { registerHttpClientManagedAgentTests } from "./http-client.test-managed-agents-support.js";
import { registerHttpClientOpsTests } from "./http-client.test-ops-support.js";

describe("createTyrumHttpClient", () => {
  registerHttpClientCoreTests();
  registerHttpClientAuthTests();
  registerHttpClientOpsTests();
  registerHttpClientManagedAgentTests();
});
