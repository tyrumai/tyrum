/**
 * Presence service — merge rules, periodic pruning, and connect/beacon helpers.
 */

import type { DeviceDescriptor, PresenceBeaconPayload, PresenceEntry, PeerRole } from "@tyrum/schemas";
import type { ConnectedClient } from "../../ws/connection-manager.js";
import type { Logger } from "../observability/logger.js";
import { PresenceDal } from "./dal.js";

function isLoopbackIp(ip: string | undefined): boolean {
  if (!ip) return false;
  return ip === "::1" || ip.startsWith("127.");
}

function mapPeerRole(role: PeerRole): PresenceEntry["role"] {
  return role === "node" ? "node" : "client";
}

function defaultModeForRole(role: PresenceEntry["role"]): PresenceEntry["mode"] {
  switch (role) {
    case "gateway":
      return "backend";
    case "node":
      return "node";
    case "client":
      return "cli";
  }
}

export interface PresenceConfig {
  ttlMs: number;
  maxEntries: number;
}

export class PresenceService {
  constructor(
    private readonly dal: PresenceDal,
    private readonly config: PresenceConfig,
    private readonly logger?: Logger,
  ) {}

  async seedGatewaySelf(params: {
    instanceId: string;
    host?: string;
    version?: string;
    nowIso?: string;
  }): Promise<PresenceEntry> {
    const nowIso = params.nowIso ?? new Date().toISOString();
    const entry: PresenceEntry = {
      instance_id: params.instanceId,
      role: "gateway",
      host: params.host,
      ip: undefined,
      version: params.version,
      mode: "backend",
      last_seen_at: nowIso,
      reason: "self",
    };
    return await this.dal.upsert(entry);
  }

  async upsertFromConnect(params: {
    role: PeerRole;
    device: DeviceDescriptor;
    remoteIp?: string;
    nowIso?: string;
  }): Promise<PresenceEntry> {
    const nowIso = params.nowIso ?? new Date().toISOString();
    const role = mapPeerRole(params.role);
    const existing = await this.dal.get(params.device.device_id);

    const entry: PresenceEntry = {
      instance_id: params.device.device_id,
      role,
      host: params.device.label ?? existing?.host,
      ip: params.remoteIp ?? existing?.ip,
      version: existing?.version,
      mode: existing?.mode ?? defaultModeForRole(role),
      last_seen_at: nowIso,
      last_input_seconds: existing?.last_input_seconds,
      reason: "connect",
    };

    return await this.dal.upsert(entry);
  }

  async touchFromHeartbeat(
    client: ConnectedClient,
    nowIso?: string,
  ): Promise<void> {
    const now = nowIso ?? new Date().toISOString();
    const existing = await this.dal.get(client.instance_id);
    if (!existing) return;

    const reason: PresenceEntry["reason"] =
      client.role === "node" ? "node-connected" : "periodic";

    await this.dal.upsert({
      ...existing,
      last_seen_at: now,
      reason,
    });
  }

  async applyBeacon(
    client: ConnectedClient,
    payload: PresenceBeaconPayload,
    nowIso?: string,
  ): Promise<PresenceEntry> {
    const now = nowIso ?? new Date().toISOString();
    const existing = await this.dal.get(client.instance_id);

    const base: PresenceEntry = existing ?? {
      instance_id: client.instance_id,
      role: mapPeerRole(client.role),
      mode: defaultModeForRole(mapPeerRole(client.role)),
      last_seen_at: now,
      reason: "periodic",
    };

    const shouldPreferBeacon = isLoopbackIp(base.ip);

    const next: PresenceEntry = {
      ...base,
      host: payload.host
        ? shouldPreferBeacon || !base.host
          ? payload.host
          : base.host
        : base.host,
      ip: payload.ip
        ? shouldPreferBeacon || !base.ip
          ? payload.ip
          : base.ip
        : base.ip,
      version: payload.version ?? base.version,
      mode: payload.mode ?? base.mode,
      last_seen_at: now,
      last_input_seconds: payload.last_input_seconds ?? base.last_input_seconds,
      reason: "periodic",
    };

    return await this.dal.upsert(next);
  }

  async prune(nowMs?: number): Promise<{ expired: string[]; trimmed: string[] }> {
    const now = nowMs ?? Date.now();
    const ttlMs = Math.max(1, this.config.ttlMs);
    const cutoffIso = new Date(Math.max(0, now - ttlMs)).toISOString();

    const expired = await this.dal.pruneExpired(cutoffIso);
    const trimmed =
      this.config.maxEntries > 0
        ? await this.dal.trimToMaxEntries(this.config.maxEntries)
        : [];

    if ((expired.length > 0 || trimmed.length > 0) && this.logger) {
      this.logger.debug("presence.pruned", {
        expired: expired.length,
        trimmed: trimmed.length,
      });
    }

    return { expired, trimmed };
  }
}

