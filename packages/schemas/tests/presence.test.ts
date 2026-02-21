import { describe, expect, it } from "vitest";
import { PresenceEntry, PresenceEvent } from "../src/index.js";

describe("PresenceEntry", () => {
  const valid = {
    client_id: "client-1",
    role: "node" as const,
    node_id: "node-1",
    capabilities: ["cli", "http"],
    connected_at: "2026-02-20T10:00:00Z",
    last_seen_at: "2026-02-20T10:05:00Z",
  };

  it("parses a valid entry", () => {
    const entry = PresenceEntry.parse(valid);
    expect(entry.client_id).toBe("client-1");
    expect(entry.role).toBe("node");
    expect(entry.capabilities).toEqual(["cli", "http"]);
  });

  it("defaults capabilities to empty array", () => {
    const { capabilities: _, ...minimal } = valid;
    const entry = PresenceEntry.parse(minimal);
    expect(entry.capabilities).toEqual([]);
  });

  it("rejects missing client_id", () => {
    const { client_id: _, ...bad } = valid;
    expect(() => PresenceEntry.parse(bad)).toThrow();
  });

  it("rejects invalid role", () => {
    expect(() => PresenceEntry.parse({ ...valid, role: "admin" })).toThrow();
  });

  it("rejects extra fields (strict)", () => {
    expect(() => PresenceEntry.parse({ ...valid, extra: true })).toThrow();
  });
});

describe("PresenceEvent", () => {
  const validEntry = {
    client_id: "c-2",
    role: "client" as const,
    connected_at: "2026-02-20T10:00:00Z",
    last_seen_at: "2026-02-20T10:00:00Z",
  };

  it("parses a valid event", () => {
    const evt = PresenceEvent.parse({
      kind: "online",
      entry: validEntry,
      occurred_at: "2026-02-20T10:00:00Z",
    });
    expect(evt.kind).toBe("online");
    expect(evt.entry.client_id).toBe("c-2");
  });

  it("rejects invalid kind", () => {
    expect(() =>
      PresenceEvent.parse({
        kind: "unknown",
        entry: validEntry,
        occurred_at: "2026-02-20T10:00:00Z",
      }),
    ).toThrow();
  });

  it("rejects extra fields (strict)", () => {
    expect(() =>
      PresenceEvent.parse({
        kind: "heartbeat",
        entry: validEntry,
        occurred_at: "2026-02-20T10:00:00Z",
        extra: 1,
      }),
    ).toThrow();
  });
});
