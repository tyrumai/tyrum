import { AuthProfileDal } from "../models/auth-profile-dal.js";
import { ConfiguredModelPresetDal } from "../models/configured-model-preset-dal.js";
import { SessionModelOverrideDal } from "../models/session-model-override-dal.js";
import { isAuthProfilesEnabled } from "../models/auth-profiles-enabled.js";
import { SessionProviderPinDal } from "../models/session-pin-dal.js";
import { IntakeModeOverrideDal } from "../agent/intake-mode-override-dal.js";
import { LaneQueueModeOverrideDal } from "../lanes/queue-mode-override-dal.js";
import { SessionSendPolicyOverrideDal } from "../channels/send-policy-override-dal.js";
import { resolveWorkspaceKey } from "../workspace/id.js";
import type { CommandDeps, CommandExecuteResult } from "./dispatcher.js";
import {
  createSessionDal,
  isLegacyPresetKey,
  jsonBlock,
  resolveAgentId,
  resolveChannelThread,
  resolveFallbackKeyLane,
  resolveKeyLane,
} from "./dispatcher-support.js";
import { IdentityScopeDal } from "../identity/scope.js";

type CommandInput = {
  cmd: string;
  deps: CommandDeps;
  toks: string[];
};

export async function tryExecuteSessionCommand(
  input: CommandInput,
): Promise<CommandExecuteResult | undefined> {
  if (input.cmd === "model") return executeModelCommand(input.deps, input.toks);
  if (input.cmd === "intake") return executeIntakeCommand(input.deps, input.toks);
  if (input.cmd === "queue") return executeQueueCommand(input.deps, input.toks);
  if (input.cmd === "send") return executeSendCommand(input.deps, input.toks);
  return undefined;
}

async function executeModelCommand(
  deps: CommandDeps,
  toks: string[],
): Promise<CommandExecuteResult> {
  if (!deps.db) {
    return { output: "Model overrides are not available on this gateway instance.", data: null };
  }

  const ctx = deps.commandContext;
  const agentId = await resolveAgentId(ctx, {
    tenantId: deps.tenantId,
    identityScopeDal: deps.db ? new IdentityScopeDal(deps.db) : undefined,
  });
  const resolved = await resolveChannelThread(deps.db, ctx);
  if (!resolved) {
    return {
      output:
        "Usage: /model <preset_key|provider/model[@profile]> (requires key or channel/thread context)",
      data: null,
    };
  }

  const session = await createSessionDal(deps.db).getOrCreate({
    scopeKeys: { agentKey: agentId, workspaceKey: resolveWorkspaceKey() },
    connectorKey: resolved.channel,
    accountKey: resolved.accountKey,
    providerThreadId: resolved.threadId,
    containerKind: "channel",
  });
  const overrides = new SessionModelOverrideDal(deps.db);
  const presetDal = new ConfiguredModelPresetDal(deps.db);
  const modelArg = toks[1];
  if (!modelArg) {
    const existing = await overrides.get({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
    });
    const payload = {
      session_id: session.session_id,
      model_id: existing?.model_id ?? null,
      preset_key: existing?.preset_key ?? null,
    };
    return { output: jsonBlock(payload), data: payload };
  }

  const trimmed = modelArg.trim();
  const at = trimmed.indexOf("@");
  const modelSelectorRaw = at >= 0 ? trimmed.slice(0, at).trim() : trimmed;
  const profileIdRaw = at >= 0 ? trimmed.slice(at + 1).trim() : undefined;
  if (profileIdRaw !== undefined && profileIdRaw.length === 0) {
    return { output: "Usage: /model <provider/model>@<profile>", data: null };
  }

  const directPreset = profileIdRaw
    ? undefined
    : await presetDal.getByKey({ tenantId: session.tenant_id, presetKey: modelSelectorRaw });
  let presetKey: string | null = directPreset?.preset_key ?? null;
  let modelIdRaw =
    directPreset != null
      ? `${directPreset.provider_key}/${directPreset.model_id}`
      : modelSelectorRaw;
  const slash = modelIdRaw.indexOf("/");
  if (slash <= 0 || slash === modelIdRaw.length - 1) {
    if (profileIdRaw) {
      return {
        output: `Invalid model '${modelSelectorRaw}' (expected provider/model).`,
        data: null,
      };
    }
    return directPreset
      ? { output: `Configured model preset '${modelSelectorRaw}' is misconfigured.`, data: null }
      : { output: `Configured model preset '${modelSelectorRaw}' not found.`, data: null };
  }

  const providerId = modelIdRaw.slice(0, slash);
  const modelId = modelIdRaw.slice(slash + 1);
  if (!directPreset && !profileIdRaw) {
    const matchingPresets = (await presetDal.list({ tenantId: session.tenant_id })).filter(
      (preset) =>
        !isLegacyPresetKey(preset.preset_key) &&
        preset.provider_key === providerId &&
        preset.model_id === modelId,
    );
    if (matchingPresets.length > 1) {
      const keys = matchingPresets
        .map((preset) => preset.preset_key)
        .toSorted((a, b) => a.localeCompare(b))
        .join(", ");
      return {
        output: `Model '${modelIdRaw}' matches multiple configured presets: ${keys}. Use /model <preset_key>.`,
        data: null,
      };
    }
    if (matchingPresets.length === 1) {
      const matchedPreset = matchingPresets[0]!;
      presetKey = matchedPreset.preset_key;
      modelIdRaw = `${matchedPreset.provider_key}/${matchedPreset.model_id}`;
    }
  }

  if (deps.modelCatalog || deps.modelsDev) {
    const loaded = deps.modelCatalog
      ? await deps.modelCatalog.getEffectiveCatalog({ tenantId: session.tenant_id })
      : await deps.modelsDev!.ensureLoaded();
    const provider = loaded.catalog[providerId];
    const providerEnabled = provider
      ? ((provider as { enabled?: boolean }).enabled ?? true)
      : false;
    const model = provider?.models?.[modelId];
    const modelEnabled = model ? ((model as { enabled?: boolean }).enabled ?? true) : false;
    if (!provider || !providerEnabled || !model || !modelEnabled) {
      return { output: `Model '${modelIdRaw}' not found in models.dev catalog.`, data: null };
    }
  }

  if (profileIdRaw) {
    if (!isAuthProfilesEnabled()) {
      return { output: "Auth profiles are not enabled on this gateway instance.", data: null };
    }
    const profile = await new AuthProfileDal(deps.db).getByKey({
      tenantId: session.tenant_id,
      authProfileKey: profileIdRaw,
    });
    if (!profile) return { output: `Auth profile ${profileIdRaw} not found.`, data: null };
    if (profile.provider_key !== providerId) {
      return {
        output: `Auth profile ${profileIdRaw} is for provider '${profile.provider_key}', not '${providerId}'.`,
        data: null,
      };
    }
    if (profile.status !== "active") {
      return { output: `Auth profile ${profileIdRaw} is not active.`, data: null };
    }

    const res = await deps.db.transaction(async (tx) => {
      const row = await new SessionModelOverrideDal(tx).upsert({
        tenantId: session.tenant_id,
        sessionId: session.session_id,
        modelId: modelIdRaw,
        presetKey: null,
      });
      const pinned = await new SessionProviderPinDal(tx).upsert({
        tenantId: session.tenant_id,
        sessionId: session.session_id,
        providerKey: providerId,
        authProfileId: profile.auth_profile_id,
      });
      return { row, pinned };
    });
    const payload = {
      session_id: res.row.session_id,
      model_id: res.row.model_id,
      provider_key: res.pinned.provider_key,
      auth_profile_id: res.pinned.auth_profile_id,
      auth_profile_key: res.pinned.auth_profile_key,
    };
    return { output: jsonBlock(payload), data: payload };
  }

  const row = await deps.db.transaction(async (tx) => {
    const overrideRow = await new SessionModelOverrideDal(tx).upsert({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
      modelId: modelIdRaw,
      presetKey,
    });
    await new SessionProviderPinDal(tx).clear({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
      providerKey: providerId,
    });
    return overrideRow;
  });
  const payload = {
    session_id: row.session_id,
    model_id: row.model_id,
    preset_key: row.preset_key,
  };
  return { output: jsonBlock(payload), data: payload };
}

async function executeIntakeCommand(
  deps: CommandDeps,
  toks: string[],
): Promise<CommandExecuteResult> {
  if (!deps.db) {
    return {
      output: "Intake mode overrides are not available on this gateway instance.",
      data: null,
    };
  }
  const agentId = await resolveAgentId(deps.commandContext, {
    tenantId: deps.tenantId,
    identityScopeDal: deps.db ? new IdentityScopeDal(deps.db) : undefined,
  });
  const resolved =
    (await resolveKeyLane(deps.db, deps.commandContext)) ??
    (await resolveFallbackKeyLane(deps.db, deps.commandContext, agentId));
  if (!resolved) {
    return {
      output:
        "Usage: /intake <auto|inline|delegate_execute|delegate_plan> (requires key or channel/thread context)",
      data: null,
    };
  }

  const dal = new IntakeModeOverrideDal(deps.db);
  const modeArg = toks[1]?.trim().toLowerCase();
  const allowed = new Set(["auto", "inline", "delegate_execute", "delegate_plan"]);
  if (!modeArg) {
    const payload = {
      key: resolved.key,
      lane: "main",
      intake_mode: (await dal.get({ key: resolved.key, lane: "main" }))?.intake_mode ?? "auto",
    };
    return { output: jsonBlock(payload), data: payload };
  }
  if (!allowed.has(modeArg)) {
    return { output: "Usage: /intake <auto|inline|delegate_execute|delegate_plan>", data: null };
  }
  if (modeArg === "auto") {
    await dal.clear({ key: resolved.key, lane: "main" });
    const payload = { key: resolved.key, lane: "main", intake_mode: "auto" };
    return { output: jsonBlock(payload), data: payload };
  }
  const row = await dal.upsert({ key: resolved.key, lane: "main", intakeMode: modeArg });
  const payload = { key: row.key, lane: row.lane, intake_mode: row.intake_mode };
  return { output: jsonBlock(payload), data: payload };
}

async function executeQueueCommand(
  deps: CommandDeps,
  toks: string[],
): Promise<CommandExecuteResult> {
  if (!deps.db) {
    return {
      output: "Queue mode overrides are not available on this gateway instance.",
      data: null,
    };
  }
  const resolved = await resolveKeyLane(deps.db, deps.commandContext);
  if (!resolved) {
    return {
      output:
        "Usage: /queue <collect|followup|steer|steer_backlog|interrupt> (requires key or channel/thread context)",
      data: null,
    };
  }

  const dal = new LaneQueueModeOverrideDal(deps.db);
  const modeArg = toks[1]?.trim().toLowerCase();
  const allowed = new Set(["collect", "followup", "steer", "steer_backlog", "interrupt"]);
  if (!modeArg) {
    const payload = {
      key: resolved.key,
      lane: resolved.lane,
      queue_mode: (await dal.get(resolved))?.queue_mode ?? "collect",
    };
    return { output: jsonBlock(payload), data: payload };
  }
  if (!allowed.has(modeArg)) {
    return { output: "Usage: /queue <collect|followup|steer|steer_backlog|interrupt>", data: null };
  }
  const row = await dal.upsert({ key: resolved.key, lane: resolved.lane, queueMode: modeArg });
  const payload = { key: row.key, lane: row.lane, queue_mode: row.queue_mode };
  return { output: jsonBlock(payload), data: payload };
}

async function executeSendCommand(
  deps: CommandDeps,
  toks: string[],
): Promise<CommandExecuteResult> {
  if (!deps.db) {
    return {
      output: "Send policy overrides are not available on this gateway instance.",
      data: null,
    };
  }
  const resolved = await resolveKeyLane(deps.db, deps.commandContext);
  if (!resolved?.key) {
    return {
      output: "Usage: /send <on|off|inherit> (requires key or channel/thread context)",
      data: null,
    };
  }

  const dal = new SessionSendPolicyOverrideDal(deps.db);
  const arg = toks[1]?.trim().toLowerCase();
  if (!arg) {
    const payload = {
      key: resolved.key,
      send_policy: (await dal.get({ key: resolved.key }))?.send_policy ?? "inherit",
    };
    return { output: jsonBlock(payload), data: payload };
  }
  if (arg === "inherit") {
    try {
      await dal.clear({ key: resolved.key });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { output: `Failed to clear send policy override: ${message}`, data: null };
    }
    const payload = { key: resolved.key, send_policy: "inherit" };
    return { output: jsonBlock(payload), data: payload };
  }
  if (arg !== "on" && arg !== "off") {
    return { output: "Usage: /send <on|off|inherit>", data: null };
  }
  const row = await dal.upsert({ key: resolved.key, sendPolicy: arg });
  const payload = { key: row.key, send_policy: row.send_policy };
  return { output: jsonBlock(payload), data: payload };
}
