import { Hono } from "hono";
import {
  ChannelAccountCreateRequest,
  ChannelAccountDeleteResponse,
  ChannelAccountMutateResponse,
  ChannelAccountUpdateRequest,
  ChannelInvalidRequestResponse,
  ChannelRegistryResponse,
  ConfiguredChannelListResponse,
  type ChannelFieldErrors,
  type ConfiguredChannelAccount,
  type RoutingConfig,
} from "@tyrum/contracts";
import { z } from "zod";
import type { SqlDb } from "../statestore/types.js";
import { requireTenantId } from "../modules/auth/claims.js";
import {
  ChannelConfigDal,
  type StoredChannelConfig,
} from "../modules/channels/channel-config-dal.js";
import { TelegramPollingStateDal } from "../modules/channels/telegram-polling-state-dal.js";
import {
  ChannelValidationError,
  getChannelRegistrySpec,
  listChannelRegistryEntries,
} from "../modules/channels/channel-config-registry.js";
import type { RoutingConfigDal } from "../modules/channels/routing-config-dal.js";

export interface ChannelConfigRouteDeps {
  db: SqlDb;
  routingConfigDal?: RoutingConfigDal;
}

function invalidRequest(message: string, fieldErrors?: ChannelFieldErrors) {
  return ChannelInvalidRequestResponse.parse({
    error: "invalid_request",
    message,
    ...(fieldErrors && Object.keys(fieldErrors).length > 0 ? { field_errors: fieldErrors } : {}),
  });
}

const notFound = (message: string) => ({
  error: "not_found" as const,
  message,
});

async function assertAgentExists(db: SqlDb, tenantId: string, agentKey: string): Promise<void> {
  const row = await db.get<{ agent_id: string }>(
    `SELECT agent_id
     FROM agents
     WHERE tenant_id = ?
       AND agent_key = ?
     LIMIT 1`,
    [tenantId, agentKey],
  );
  if (!row?.agent_id) {
    throw new ChannelValidationError(`target agent '${agentKey}' does not exist`, {
      agent_key: [`target agent '${agentKey}' does not exist`],
    });
  }
}

function issueFieldKey(path: readonly PropertyKey[]): string | undefined {
  const first = path[0];
  if (first === "config" || first === "secrets") {
    return typeof path[1] === "string" ? path[1] : undefined;
  }
  if (typeof first === "string") {
    return first;
  }
  return undefined;
}

function fieldErrorsFromZodError(error: z.ZodError): ChannelFieldErrors | undefined {
  const fieldErrors: ChannelFieldErrors = {};
  for (const issue of error.issues) {
    const fieldKey = issueFieldKey(issue.path);
    if (!fieldKey) {
      continue;
    }
    fieldErrors[fieldKey] ??= [];
    fieldErrors[fieldKey]!.push(issue.message);
  }
  return Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined;
}

function inferFieldErrorsFromError(error: unknown): ChannelFieldErrors | undefined {
  if (error instanceof ChannelValidationError) {
    return error.fieldErrors;
  }
  if (error instanceof z.ZodError) {
    return fieldErrorsFromZodError(error);
  }
  if (!(error instanceof Error)) {
    return undefined;
  }
  const message = error.message;
  if (message.includes("already exists")) {
    return { account_key: [message] };
  }
  if (message.includes("webhook secret")) {
    return { webhook_secret: [message] };
  }
  if (message.includes("target agent")) {
    return { agent_key: [message] };
  }
  return undefined;
}

function invalidRequestFromError(error: unknown, fallbackMessage: string) {
  const message = error instanceof Error ? error.message : fallbackMessage;
  return invalidRequest(message, inferFieldErrorsFromError(error));
}

function resolveEffectiveTelegramAgentKey(
  config: StoredChannelConfig,
  routing: RoutingConfig | undefined,
): string | undefined {
  if (config.channel !== "telegram") {
    return undefined;
  }
  return (
    config.agent_key?.trim() ||
    routing?.telegram?.accounts?.[config.account_key]?.default_agent_key?.trim() ||
    "default"
  );
}

async function listConfiguredChannelGroups(
  deps: ChannelConfigRouteDeps,
  tenantId: string,
  dal: ChannelConfigDal,
  telegramPollingStateDal: TelegramPollingStateDal,
) {
  const [entries, legacyRouting] = await Promise.all([
    dal.listEntries(tenantId),
    deps.routingConfigDal?.getLatest(tenantId),
  ]);
  const routing = legacyRouting?.config;
  const pollingStateByAccount = new Map(
    (await telegramPollingStateDal.listByTenant(tenantId)).map(
      (row) => [row.account_key, row] as const,
    ),
  );
  const registry = new Map(
    listChannelRegistryEntries().map((entry) => [entry.channel, entry] as const),
  );

  const grouped = new Map<
    string,
    {
      channel: string;
      name: string;
      doc: string | null;
      supported: boolean;
      configurable: boolean;
      accounts: ConfiguredChannelAccount[];
    }
  >();

  for (const entry of entries) {
    const spec = getChannelRegistrySpec(entry.config.channel);
    const registryEntry = registry.get(entry.config.channel);
    if (!spec || !registryEntry) {
      continue;
    }
    const current = grouped.get(entry.config.channel) ?? {
      channel: registryEntry.channel,
      name: registryEntry.name,
      doc: registryEntry.doc,
      supported: registryEntry.supported,
      configurable: registryEntry.configurable,
      accounts: [] as ConfiguredChannelAccount[],
    };
    const account = spec.toConfiguredAccount({
      config: entry.config as never,
      effectiveAgentKey: resolveEffectiveTelegramAgentKey(entry.config, routing),
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    });
    if (entry.config.channel === "telegram") {
      const pollingState = pollingStateByAccount.get(entry.config.account_key);
      account.config = {
        ...account.config,
        ingress_mode: entry.config.ingress_mode,
        polling_status: pollingState?.status ?? "idle",
        polling_last_error_at: pollingState?.last_error_at ?? null,
        polling_last_error_message: pollingState?.last_error_message ?? null,
      };
    }
    current.accounts.push(account);
    grouped.set(entry.config.channel, current);
  }

  const channels = Array.from(grouped.values())
    .map((group) => {
      const accounts = group.accounts.toSorted((left, right) =>
        left.account_key.localeCompare(right.account_key),
      );
      return {
        channel: group.channel,
        name: group.name,
        doc: group.doc,
        supported: group.supported,
        configurable: group.configurable,
        accounts,
      };
    })
    .toSorted((left, right) => left.name.localeCompare(right.name));
  return ConfiguredChannelListResponse.parse({ status: "ok", channels });
}

export function createChannelConfigRoutes(deps: ChannelConfigRouteDeps): Hono {
  const app = new Hono();
  const dal = new ChannelConfigDal(deps.db);
  const telegramPollingStateDal = new TelegramPollingStateDal(deps.db);

  app.get("/config/channels/registry", async (c) => {
    return c.json(
      ChannelRegistryResponse.parse({
        status: "ok",
        channels: listChannelRegistryEntries().filter((entry) => entry.configurable),
      }),
    );
  });

  app.get("/config/channels", async (c) => {
    const tenantId = requireTenantId(c);
    return c.json(await listConfiguredChannelGroups(deps, tenantId, dal, telegramPollingStateDal));
  });

  app.post("/config/channels/accounts", async (c) => {
    const tenantId = requireTenantId(c);
    const body = (await c.req.json().catch(() => undefined)) as unknown;
    const parsed = ChannelAccountCreateRequest.safeParse(body);
    if (!parsed.success) {
      return c.json(
        invalidRequest(parsed.error.message, fieldErrorsFromZodError(parsed.error)),
        400,
      );
    }

    const spec = getChannelRegistrySpec(parsed.data.channel);
    if (!spec?.entry.configurable) {
      return c.json(invalidRequest("channel is not configurable"), 400);
    }

    try {
      const config = await spec.create({
        accountKey: parsed.data.account_key,
        config: parsed.data.config,
        secrets: parsed.data.secrets,
      });
      const targetAgentKey = config.agent_key?.trim();
      if (!targetAgentKey) {
        throw new Error("Target agent is required");
      }
      await assertAgentExists(deps.db, tenantId, targetAgentKey);
      await dal.create({ tenantId, config });
      const stored = await dal.getEntryByChannelAndAccountKey({
        tenantId,
        connectorKey: config.channel,
        accountKey: config.account_key,
      });
      if (!stored) {
        throw new Error("channel account was not persisted");
      }
      return c.json(
        ChannelAccountMutateResponse.parse({
          status: "ok",
          account: spec.toConfiguredAccount({
            config: stored.config as never,
            effectiveAgentKey: resolveEffectiveTelegramAgentKey(stored.config, undefined),
            createdAt: stored.createdAt,
            updatedAt: stored.updatedAt,
          }),
        }),
        201,
      );
    } catch (error) {
      return c.json(invalidRequestFromError(error, "unable to create channel account"), 400);
    }
  });

  app.patch("/config/channels/accounts/:channel/:accountKey", async (c) => {
    const tenantId = requireTenantId(c);
    const channel = c.req.param("channel");
    const accountKey = c.req.param("accountKey");
    const body = (await c.req.json().catch(() => undefined)) as unknown;
    const parsed = ChannelAccountUpdateRequest.safeParse(body);
    if (!parsed.success) {
      return c.json(
        invalidRequest(parsed.error.message, fieldErrorsFromZodError(parsed.error)),
        400,
      );
    }

    const spec = getChannelRegistrySpec(channel);
    if (!spec?.entry.configurable) {
      return c.json(notFound("channel account not found"), 404);
    }

    const existing = await dal.getByChannelAndAccountKey({
      tenantId,
      connectorKey: spec.entry.channel,
      accountKey,
    });
    if (!existing || existing.channel !== spec.entry.channel) {
      return c.json(notFound("channel account not found"), 404);
    }

    try {
      const next = await spec.update({
        current: existing as never,
        config: parsed.data.config ?? {},
        secrets: parsed.data.secrets ?? {},
        clearSecretKeys: new Set(parsed.data.clear_secret_keys ?? []),
      });
      const targetAgentKey = next.agent_key?.trim();
      if (!targetAgentKey) {
        throw new Error("Target agent is required");
      }
      await assertAgentExists(deps.db, tenantId, targetAgentKey);
      await dal.replace({ tenantId, config: next });
      const stored = await dal.getEntryByChannelAndAccountKey({
        tenantId,
        connectorKey: next.channel,
        accountKey: next.account_key,
      });
      if (!stored) {
        throw new Error("channel account was not persisted");
      }
      return c.json(
        ChannelAccountMutateResponse.parse({
          status: "ok",
          account: spec.toConfiguredAccount({
            config: stored.config as never,
            effectiveAgentKey: resolveEffectiveTelegramAgentKey(stored.config, undefined),
            createdAt: stored.createdAt,
            updatedAt: stored.updatedAt,
          }),
        }),
      );
    } catch (error) {
      return c.json(invalidRequestFromError(error, "unable to update channel account"), 400);
    }
  });

  app.delete("/config/channels/accounts/:channel/:accountKey", async (c) => {
    const tenantId = requireTenantId(c);
    const channel = c.req.param("channel");
    const accountKey = c.req.param("accountKey");
    const spec = getChannelRegistrySpec(channel);
    if (!spec?.entry.configurable) {
      return c.json(notFound("channel account not found"), 404);
    }

    const deleted = await dal.delete({
      tenantId,
      connectorKey: spec.entry.channel,
      accountKey,
    });
    if (!deleted) {
      return c.json(notFound("channel account not found"), 404);
    }
    return c.json(
      ChannelAccountDeleteResponse.parse({
        status: "ok",
        deleted: true,
        channel: spec.entry.channel,
        account_key: accountKey,
      }),
    );
  });

  return app;
}
