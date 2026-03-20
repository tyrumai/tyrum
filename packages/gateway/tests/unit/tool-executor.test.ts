import { describe } from "vitest";
import { registerToolExecutorBuiltinCoreTests } from "./tool-executor.builtin-core-test-support.js";
import { registerToolExecutorLocationToolTests } from "./tool-executor.location-tools-test-support.js";
import {
  registerMcpDelegationTests,
  registerPathSandboxingTests,
} from "./tool-executor.delegation-test-support.js";
import {
  registerEnvSanitizationTests,
  registerSanitizeEnvTests,
  registerSsrfProtectionTests,
} from "./tool-executor.security-test-support.js";
import { registerTempHomeLifecycle } from "./tool-executor.shared-test-support.js";
import { registerToolExecutorNodeDispatchTests } from "./tool-executor.node-dispatch-test-support.js";
import { registerToolExecutorNodeToolTests } from "./tool-executor.node-tools-test-support.js";

describe("ToolExecutor", () => {
  const home = registerTempHomeLifecycle();

  describe("builtin routing", () => {
    registerToolExecutorBuiltinCoreTests(home);
    registerToolExecutorLocationToolTests(home);
    registerToolExecutorNodeDispatchTests(home);
    registerToolExecutorNodeToolTests(home);
  });

  describe("path sandboxing", () => {
    registerPathSandboxingTests(home);
  });

  describe("MCP delegation", () => {
    registerMcpDelegationTests(home);
  });
});

describe("sanitizeEnv", registerSanitizeEnvTests);

describe("env sanitization", () => {
  const home = registerTempHomeLifecycle();
  registerEnvSanitizationTests(home);
});

describe("SSRF protection", registerSsrfProtectionTests);
