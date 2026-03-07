import { expect, it } from "vitest";
import {
  isBlockedUrl,
  resolvesToBlockedAddress,
  sanitizeEnv,
} from "../../src/modules/agent/tool-executor.js";
import {
  createToolExecutor,
  requireHomeDir,
  type HomeDirState,
} from "./tool-executor.shared-test-support.js";

const sanitizeEnvCases = [
  {
    name: "strips TYRUM_* prefixed vars",
    env: { TYRUM_SECRET: "s", TYRUM_HOME: "/h", PATH: "/usr/bin" },
    expected: { PATH: "/usr/bin" },
  },
  {
    name: "strips GATEWAY_* prefixed vars",
    env: { GATEWAY_PORT: "3000", GATEWAY_SECRET: "x", HOME: "/home/test" },
    expected: { HOME: "/home/test" },
  },
  {
    name: "strips TELEGRAM_BOT_TOKEN exact match",
    env: { TELEGRAM_BOT_TOKEN: "tok123", TELEGRAM_OTHER: "safe" },
    expected: { TELEGRAM_OTHER: "safe" },
  },
  {
    name: "preserves PATH, HOME, LANG, USER",
    env: { PATH: "/usr/bin", HOME: "/home/u", LANG: "en_US.UTF-8", USER: "u" },
    expected: { PATH: "/usr/bin", HOME: "/home/u", LANG: "en_US.UTF-8", USER: "u" },
  },
  {
    name: "accepts extra deny prefixes and names",
    env: { CUSTOM_KEY: "v", SECRET_X: "v2", KEEP: "ok" },
    extraPrefixes: ["CUSTOM_"],
    extraNames: new Set(["SECRET_X"]),
    expected: { KEEP: "ok" },
  },
  {
    name: "skips entries with undefined values",
    env: { DEFINED: "yes", UNDEF: undefined },
    expected: { DEFINED: "yes" },
  },
] as const;

const ssrfUrlCases = [
  { name: "blocks IPv6 loopback [::1]", url: "http://[::1]/", blocked: true },
  { name: "blocks IPv6 link-local [fe80::1]", url: "http://[fe80::1]/", blocked: true },
  { name: "blocks IPv6 unique-local [fc00::1]", url: "http://[fc00::1]/", blocked: true },
  { name: "blocks IPv6 unique-local [fd00::1]", url: "http://[fd00::1]/", blocked: true },
  {
    name: "blocks IPv4-mapped IPv6 [::ffff:127.0.0.1]",
    url: "http://[::ffff:127.0.0.1]/",
    blocked: true,
  },
  {
    name: "blocks IPv4-mapped IPv6 [::ffff:10.0.0.1]",
    url: "http://[::ffff:10.0.0.1]/",
    blocked: true,
  },
  {
    name: "blocks decimal integer IP 2130706433 (127.0.0.1)",
    url: "http://2130706433/",
    blocked: true,
  },
  { name: "blocks hex IP 0x7f000001 (127.0.0.1)", url: "http://0x7f000001/", blocked: true },
  { name: "blocks octal IP 0177.0.0.1 (127.0.0.1)", url: "http://0177.0.0.1/", blocked: true },
  {
    name: "blocks cloud metadata hostname metadata.google.internal",
    url: "http://metadata.google.internal/",
    blocked: true,
  },
  { name: "blocks 10.x.x.x", url: "http://10.0.0.1/", blocked: true },
  { name: "blocks 172.16.x.x", url: "http://172.16.0.1/", blocked: true },
  { name: "blocks 192.168.x.x", url: "http://192.168.1.1/", blocked: true },
  { name: "blocks 169.254.x.x (link-local)", url: "http://169.254.169.254/", blocked: true },
  { name: "blocks 127.0.0.1", url: "http://127.0.0.1/", blocked: true },
  { name: "blocks localhost", url: "http://localhost/", blocked: true },
  {
    name: "allows public hostname https://example.com",
    url: "https://example.com",
    blocked: false,
  },
  { name: "allows public IP 8.8.8.8", url: "http://8.8.8.8/", blocked: false },
  { name: "blocks non-http URL schemes", url: "file:///etc/passwd", blocked: true },
] as const;

export function registerSanitizeEnvTests(): void {
  for (const testCase of sanitizeEnvCases) {
    it(testCase.name, () => {
      expect(sanitizeEnv(testCase.env, testCase.extraPrefixes, testCase.extraNames)).toEqual(
        testCase.expected,
      );
    });
  }
}

export function registerEnvSanitizationTests(home: HomeDirState): void {
  it("tool.exec does not leak sensitive env vars", async () => {
    const origTyrum = process.env["TYRUM_TEST_SECRET"];
    const origGateway = process.env["GATEWAY_TEST_SECRET"];
    process.env["TYRUM_TEST_SECRET"] = "should-not-appear";
    process.env["GATEWAY_TEST_SECRET"] = "should-not-appear-either";

    try {
      const result = await createToolExecutor({ homeDir: requireHomeDir(home) }).execute(
        "tool.exec",
        "call-env-1",
        { command: "env" },
      );

      expect(result.error).toBeUndefined();
      expect(result.output).not.toContain("TYRUM_TEST_SECRET");
      expect(result.output).not.toContain("GATEWAY_TEST_SECRET");
      expect(result.output).toContain("PATH=");
    } finally {
      if (origTyrum === undefined) delete process.env["TYRUM_TEST_SECRET"];
      else process.env["TYRUM_TEST_SECRET"] = origTyrum;

      if (origGateway === undefined) delete process.env["GATEWAY_TEST_SECRET"];
      else process.env["GATEWAY_TEST_SECRET"] = origGateway;
    }
  });
}

export function registerSsrfProtectionTests(): void {
  for (const testCase of ssrfUrlCases) {
    it(testCase.name, () => {
      expect(isBlockedUrl(testCase.url)).toBe(testCase.blocked);
    });
  }

  it("blocks when DNS resolves to a private IPv4", async () => {
    const blocked = await resolvesToBlockedAddress("https://safe.example/path", async () => [
      { address: "192.168.1.10", family: 4 },
    ]);

    expect(blocked).toBe(true);
  });

  it("allows when DNS resolves to public addresses only", async () => {
    const blocked = await resolvesToBlockedAddress("https://safe.example/path", async () => [
      { address: "8.8.8.8", family: 4 },
    ]);

    expect(blocked).toBe(false);
  });
}
