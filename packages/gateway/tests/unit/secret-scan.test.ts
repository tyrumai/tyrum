import { describe, expect, it } from "vitest";
import { scanForSecretPatterns } from "../../src/modules/redaction/engine.js";

describe("scanForSecretPatterns", () => {
  it("detects API key patterns", () => {
    const result = scanForSecretPatterns("my key is sk-abc123def456789012345678");
    expect(result).toContain("api_key_prefix");
  });

  it("detects AWS access key", () => {
    const result = scanForSecretPatterns("AKIAIOSFODNN7EXAMPLE");
    expect(result).toContain("aws_access_key");
  });

  it("detects GitHub tokens", () => {
    const result = scanForSecretPatterns("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij");
    expect(result).toContain("github_token");
  });

  it("detects private key markers", () => {
    const result = scanForSecretPatterns("-----BEGIN RSA PRIVATE KEY-----");
    expect(result).toContain("private_key");
  });

  it("detects password assignments", () => {
    const result = scanForSecretPatterns('password="my_super_secret_password"');
    expect(result).toContain("password_assignment");
  });

  it("detects connection strings with credentials", () => {
    const result = scanForSecretPatterns("postgres://user:pass@localhost:5432/db");
    expect(result).toContain("connection_string");
  });

  it("returns empty array for clean text", () => {
    const result = scanForSecretPatterns("This is just a regular fact about the user's preferences");
    expect(result).toHaveLength(0);
  });

  it("detects multiple patterns", () => {
    const result = scanForSecretPatterns('AKIAIOSFODNN7EXAMPLE password="secret_pass_here!"');
    expect(result.length).toBeGreaterThanOrEqual(2);
  });
});
