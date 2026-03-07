import { TyrumHttpClientError, createTyrumHttpClient } from "@tyrum/client/node";

import type { CliCommand } from "../cli-command.js";
import { resolveOperatorElevatedModePath } from "../operator-paths.js";
import {
  clearOperatorElevatedModeState,
  formatRemainingMs,
  loadOperatorElevatedModeState,
  requireIsoDateTimeMs,
  requireOperatorConfig,
  saveOperatorElevatedModeState,
} from "../operator-state.js";

export async function handleElevatedModeStatus(
  _command: Extract<CliCommand, { kind: "elevated_mode_status" }>,
  home: string,
): Promise<number> {
  try {
    const statePath = resolveOperatorElevatedModePath(home);
    const state = await loadOperatorElevatedModeState(statePath);
    if (!state) {
      console.log("elevated-mode: inactive");
      return 0;
    }
    const expiresAtMs = requireIsoDateTimeMs(state.expiresAt, "elevated mode expiresAt");
    const remainingMs = Math.max(0, expiresAtMs - Date.now());
    console.log(
      `elevated-mode: active remaining=${formatRemainingMs(remainingMs)} expires_at=${state.expiresAt}`,
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`elevated-mode.status: failed: ${message}`);
    return 1;
  }
}

export async function handleElevatedModeExit(
  _command: Extract<CliCommand, { kind: "elevated_mode_exit" }>,
  home: string,
): Promise<number> {
  try {
    const statePath = resolveOperatorElevatedModePath(home);
    await clearOperatorElevatedModeState(statePath);
    console.log("elevated-mode.exit: ok");
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`elevated-mode.exit: failed: ${message}`);
    return 1;
  }
}

export async function handleElevatedModeEnter(
  command: Extract<CliCommand, { kind: "elevated_mode_enter" }>,
  home: string,
): Promise<number> {
  try {
    const config = await requireOperatorConfig(home);
    const http = createTyrumHttpClient({
      baseUrl: config.gateway_url,
      auth: { type: "bearer", token: config.auth_token },
      ...(config.tls_cert_fingerprint256
        ? { tlsCertFingerprint256: config.tls_cert_fingerprint256 }
        : {}),
      ...(config.tls_allow_self_signed ? { tlsAllowSelfSigned: true } : {}),
    });

    const issued = await http.deviceTokens.issue({
      device_id: "operator-cli",
      role: "client",
      scopes: ["operator.admin"],
      ttl_seconds: command.ttl_seconds ?? 60 * 10,
    });
    if (!issued.expires_at) {
      throw new Error("gateway returned a persistent elevated-mode token without expires_at");
    }

    const statePath = resolveOperatorElevatedModePath(home);
    await saveOperatorElevatedModeState(statePath, {
      elevatedToken: issued.token,
      expiresAt: issued.expires_at,
    });

    console.log(`elevated-mode.enter: ok expires_at=${issued.expires_at}`);
    return 0;
  } catch (error) {
    if (error instanceof TyrumHttpClientError) {
      const status = error.status ? `status=${String(error.status)}` : "status=unknown";
      console.error(`elevated-mode.enter: failed: ${status} message=${error.message}`);
      return 1;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`elevated-mode.enter: failed: ${message}`);
    return 1;
  }
}
