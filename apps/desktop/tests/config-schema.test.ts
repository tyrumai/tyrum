import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DesktopNodeConfig, DEFAULT_CONFIG, PermissionProfile } from "../src/main/config/schema.js";
import { loadConfig, saveConfig } from "../src/main/config/store.js";
import { decryptToken, encryptToken } from "../src/main/config/token-store.js";

// ---------------------------------------------------------------------------
// Schema tests
// ---------------------------------------------------------------------------

describe("DesktopNodeConfig schema", () => {
  it("parses default config from empty object", () => {
    const parsed = DesktopNodeConfig.parse({});
    expect(parsed).toEqual(DEFAULT_CONFIG);
  });

  it("defaults mode to 'embedded' and profile to 'balanced'", () => {
    const parsed = DesktopNodeConfig.parse({});
    expect(parsed.mode).toBe("embedded");
    expect(parsed.permissions.profile).toBe("balanced");
  });

  it("defaults capabilities: desktop true, playwright/cli/http false", () => {
    const parsed = DesktopNodeConfig.parse({});
    expect(parsed.capabilities.desktop).toBe(true);
    expect(parsed.capabilities.playwright).toBe(false);
    expect(parsed.capabilities.cli).toBe(false);
    expect(parsed.capabilities.http).toBe(false);
  });

  it("defaults remote.tlsCertFingerprint256 to empty string", () => {
    const parsed = DesktopNodeConfig.parse({});
    expect((parsed.remote as any).tlsCertFingerprint256).toBe("");
  });

  it("accepts remote.tlsCertFingerprint256", () => {
    const parsed = DesktopNodeConfig.parse({
      mode: "remote",
      remote: { tlsCertFingerprint256: "AA:BB" },
    } as any);
    expect((parsed.remote as any).tlsCertFingerprint256).toBe("AA:BB");
  });

  it("rejects invalid mode", () => {
    const result = DesktopNodeConfig.safeParse({ mode: "invalid" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid permission profile", () => {
    const result = DesktopNodeConfig.safeParse({
      permissions: { profile: "root" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid permission overrides", () => {
    const parsed = DesktopNodeConfig.parse({
      permissions: {
        profile: "safe",
        overrides: { "fs.read": true, "fs.write": false },
      },
    });
    expect(parsed.permissions.overrides).toEqual({
      "fs.read": true,
      "fs.write": false,
    });
  });

  it("validates port range: rejects below 1024", () => {
    const result = DesktopNodeConfig.safeParse({
      embedded: { port: 80 },
    });
    expect(result.success).toBe(false);
  });

  it("validates port range: rejects above 65535", () => {
    const result = DesktopNodeConfig.safeParse({
      embedded: { port: 70000 },
    });
    expect(result.success).toBe(false);
  });

  it("accepts port at boundaries (1024 and 65535)", () => {
    const low = DesktopNodeConfig.parse({ embedded: { port: 1024 } });
    expect(low.embedded.port).toBe(1024);

    const high = DesktopNodeConfig.parse({ embedded: { port: 65535 } });
    expect(high.embedded.port).toBe(65535);
  });

  it("round-trip: parse -> serialize -> re-parse is stable", () => {
    const first = DesktopNodeConfig.parse({
      mode: "remote",
      remote: { wsUrl: "ws://example.com:9090/ws" },
      capabilities: { playwright: true },
    });
    const json = JSON.parse(JSON.stringify(first)) as unknown;
    const second = DesktopNodeConfig.parse(json);
    expect(second).toEqual(first);
  });
});

describe("PermissionProfile enum", () => {
  it("accepts all valid profiles", () => {
    for (const p of ["safe", "balanced", "poweruser"] as const) {
      expect(PermissionProfile.parse(p)).toBe(p);
    }
  });
});

// ---------------------------------------------------------------------------
// Store tests (file I/O)
// ---------------------------------------------------------------------------

describe("Config store", () => {
  let tmpDir: string;
  let origEnv: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tyrum-test-"));
    origEnv = process.env["TYRUM_HOME"];
    process.env["TYRUM_HOME"] = tmpDir;
  });

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env["TYRUM_HOME"];
    } else {
      process.env["TYRUM_HOME"] = origEnv;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadConfig returns default when file does not exist", () => {
    const config = loadConfig();
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("saveConfig + loadConfig round-trip works", () => {
    const custom = DesktopNodeConfig.parse({
      mode: "remote",
      remote: { wsUrl: "ws://10.0.0.1:3000/ws", tokenRef: "env:MY_TOKEN" },
      capabilities: { cli: true, http: true },
      cli: { allowedCommands: ["ls", "cat"] },
    });

    saveConfig(custom);

    // Verify file was written
    const filePath = join(tmpDir, "desktop-node.json");
    const raw = readFileSync(filePath, "utf-8");
    expect(JSON.parse(raw)).toBeTruthy();

    // Verify round-trip
    const loaded = loadConfig();
    expect(loaded).toEqual(custom);
  });

  it("migrates device.privateKey to device.privateKeyRef on save", () => {
    const config = DesktopNodeConfig.parse({
      device: {
        enabled: true,
        deviceId: "device-1",
        publicKey: "pub",
        privateKey: "legacy-private-key",
      },
    });

    saveConfig(config);

    const filePath = join(tmpDir, "desktop-node.json");
    const raw = readFileSync(filePath, "utf-8");
    expect(raw).not.toContain("legacy-private-key");

    const persisted = DesktopNodeConfig.parse(JSON.parse(raw));
    expect(persisted.device.privateKey).toBe("");
    expect(persisted.device.privateKeyRef).toBeTruthy();
    expect(decryptToken(persisted.device.privateKeyRef)).toBe("legacy-private-key");
  });

  it("overwrites device.privateKeyRef when device.privateKey is provided", () => {
    const config = DesktopNodeConfig.parse({
      device: {
        enabled: true,
        deviceId: "device-1",
        publicKey: "pub",
        privateKey: "new-private-key",
        privateKeyRef: encryptToken("old-private-key"),
      },
    });

    saveConfig(config);

    const filePath = join(tmpDir, "desktop-node.json");
    const raw = readFileSync(filePath, "utf-8");
    expect(raw).not.toContain("new-private-key");

    const persisted = DesktopNodeConfig.parse(JSON.parse(raw));
    expect(persisted.device.privateKey).toBe("");
    expect(decryptToken(persisted.device.privateKeyRef)).toBe("new-private-key");
  });

  it("migrates legacy device.privateKey to device.privateKeyRef on load", () => {
    const filePath = join(tmpDir, "desktop-node.json");
    const legacy = DesktopNodeConfig.parse({
      device: {
        enabled: true,
        deviceId: "device-1",
        publicKey: "pub",
        privateKey: "legacy-private-key",
        privateKeyRef: "",
      },
    });
    // Write raw legacy payload (privateKey plaintext) to simulate older versions.
    const legacyRaw = JSON.stringify(legacy, null, 2);
    expect(legacyRaw).toContain("legacy-private-key");
    writeFileSync(filePath, legacyRaw, { mode: 0o600 });

    const loaded = loadConfig();
    expect(loaded.device.privateKey).toBe("");
    expect(loaded.device.privateKeyRef).toBeTruthy();
    expect(decryptToken(loaded.device.privateKeyRef)).toBe("legacy-private-key");

    const migratedRaw = readFileSync(filePath, "utf-8");
    expect(migratedRaw).not.toContain("legacy-private-key");
  });

  it("saveConfig writes config file with owner-only permissions", () => {
    saveConfig(DEFAULT_CONFIG);
    const filePath = join(tmpDir, "desktop-node.json");
    const mode = statSync(filePath).mode & 0o777;
    if (process.platform === "win32") {
      // Windows ACLs do not map cleanly to POSIX mode bits.
      expect(mode & 0o600).toBe(0o600);
      return;
    }
    expect(mode).toBe(0o600);
  });
});
