import type {
  TranscriptSessionSummary,
  TranscriptTimelineEvent,
  WsResponseEnvelope,
} from "@tyrum/contracts";
import {
  WsTranscriptGetRequest,
  WsTranscriptGetResult,
  WsTranscriptListRequest,
  WsTranscriptListResult,
} from "@tyrum/contracts";
import type { RawSubagentRow } from "../../app/modules/workboard/dal-helpers.js";
import { toSubagent } from "../../app/modules/workboard/dal-helpers.js";
import type { ConnectedClient } from "../connection-manager.js";
import { errorResponse } from "./helpers.js";
import { resolveChatAgentKey } from "./ai-sdk-chat-session-ops.js";
import { createSessionDal, sessionErrorResponse } from "./session-protocol-shared.js";
import {
  loadDescendantSessionRecords,
  loadLineageSubagentRows,
  listChildSessionRecords,
  listSessionRecords,
  listSubagentRows,
  resolveWorkspaceId,
} from "./transcript-handlers.data.js";
import {
  buildLatestRunInfoByKey,
  buildTranscriptSessionSummaries,
  attachDirectChildSummaries,
  loadPendingApprovalCountByKey,
  loadRunDetailsByKey,
  shouldKeepTranscriptRootSummary,
} from "./transcript-handlers.runs.js";
import {
  compareTimelineEvents,
  readMessageOccurredAt,
  resolveApprovalEvents,
} from "./transcript-handlers.timeline.js";
import type { SessionLineageRecord } from "./transcript-handlers.types.js";
import type { ProtocolDeps, ProtocolRequestEnvelope } from "./types.js";

const MAX_ACTIVE_ONLY_SCAN_PAGES = 10;
export async function handleTranscriptMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope | undefined> {
  if (msg.type === "transcript.list") {
    return await handleTranscriptListMessage(client, msg, deps);
  }
  if (msg.type === "transcript.get") {
    return await handleTranscriptGetMessage(client, msg, deps);
  }
  return undefined;
}

async function handleTranscriptListMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope> {
  if (client.role !== "client") {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unauthorized",
      "only operator clients may list transcripts",
    );
  }
  if (!deps.db) {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unsupported_request",
      "transcript.list not supported",
    );
  }

  const parsed = WsTranscriptListRequest.safeParse(msg);
  if (!parsed.success) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", parsed.error.message, {
      issues: parsed.error.issues,
    });
  }

  const tenantId = client.auth_claims?.tenant_id;
  if (!tenantId) {
    return errorResponse(msg.request_id, msg.type, "unauthorized", "tenant token required");
  }

  try {
    const { identityScopeDal, workspaceId } = await resolveWorkspaceId(deps, tenantId);
    const agentKey = parsed.data.payload.agent_key
      ? await resolveChatAgentKey({
          tenantId,
          requestedAgentKey: parsed.data.payload.agent_key,
          deps,
        })
      : undefined;
    if (agentKey) {
      const agentId = await identityScopeDal.resolveAgentId(tenantId, agentKey);
      if (!agentId) {
        return errorResponse(msg.request_id, msg.type, "not_found", "agent not found");
      }
    }

    const activeOnly = parsed.data.payload.active_only === true;
    const limit = parsed.data.payload.limit ?? 200;
    let cursor = parsed.data.payload.cursor;
    let scannedPages = 0;

    while (true) {
      scannedPages += 1;
      const listedRoots = await listSessionRecords({
        deps,
        tenantId,
        workspaceId,
        agentKey,
        channel: parsed.data.payload.channel,
        archived: parsed.data.payload.archived,
        limit,
        cursor,
      });
      const rootSessionKeys = listedRoots.sessions.map((session) => session.sessionKey);
      const childSessions = activeOnly
        ? await loadDescendantSessionRecords({
            deps,
            tenantId,
            workspaceId,
            parentSessionKeys: rootSessionKeys,
          })
        : await listChildSessionRecords({
            deps,
            tenantId,
            workspaceId,
            rootSessionKeys,
          });
      const sessions = [...listedRoots.sessions, ...childSessions];
      const sessionKeys = sessions.map((session) => session.sessionKey);
      const subagentRows = await listSubagentRows({
        deps,
        tenantId,
        workspaceId,
        sessionKeys,
      });
      const runDetailsByKey = await loadRunDetailsByKey({
        deps,
        tenantId,
        keys: sessionKeys,
      });
      const summaries = buildTranscriptSessionSummaries({
        sessions,
        subagentsBySessionKey: new Map(subagentRows.map((row) => [row.session_key, row])),
        latestRunsByKey: buildLatestRunInfoByKey(runDetailsByKey),
        pendingApprovalsByKey: await loadPendingApprovalCountByKey({
          deps,
          tenantId,
          keys: sessionKeys,
        }),
      });
      const summariesBySessionKey = new Map(
        summaries.map((summary) => [summary.session_key, summary] as const),
      );
      const roots = listedRoots.sessions
        .map((session) => summariesBySessionKey.get(session.sessionKey))
        .filter((summary): summary is TranscriptSessionSummary => summary !== undefined);
      const children = childSessions
        .map((session) => summariesBySessionKey.get(session.sessionKey))
        .filter((summary): summary is TranscriptSessionSummary => summary !== undefined);
      const attached = attachDirectChildSummaries({ roots, children }).filter((summary) =>
        shouldKeepTranscriptRootSummary(summary, activeOnly),
      );

      if (
        activeOnly &&
        attached.length === 0 &&
        listedRoots.nextCursor &&
        scannedPages < MAX_ACTIVE_ONLY_SCAN_PAGES
      ) {
        cursor = listedRoots.nextCursor;
        continue;
      }

      return {
        request_id: msg.request_id,
        type: msg.type,
        ok: true,
        result: WsTranscriptListResult.parse({
          sessions: attached,
          next_cursor: listedRoots.nextCursor,
        }),
      };
    }
  } catch (err) {
    return sessionErrorResponse({
      deps,
      err,
      msg,
      client,
      logEvent: "ws.transcript_list_failed",
      invalidCursor: err instanceof Error && err.message === "invalid cursor",
    });
  }
}

async function handleTranscriptGetMessage(
  client: ConnectedClient,
  msg: ProtocolRequestEnvelope,
  deps: ProtocolDeps,
): Promise<WsResponseEnvelope> {
  if (client.role !== "client") {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unauthorized",
      "only operator clients may fetch transcripts",
    );
  }
  if (!deps.db) {
    return errorResponse(
      msg.request_id,
      msg.type,
      "unsupported_request",
      "transcript.get not supported",
    );
  }

  const parsed = WsTranscriptGetRequest.safeParse(msg);
  if (!parsed.success) {
    return errorResponse(msg.request_id, msg.type, "invalid_request", parsed.error.message, {
      issues: parsed.error.issues,
    });
  }

  const tenantId = client.auth_claims?.tenant_id;
  if (!tenantId) {
    return errorResponse(msg.request_id, msg.type, "unauthorized", "tenant token required");
  }

  try {
    const sessionDal = createSessionDal(deps);
    const focus = await sessionDal.getWithDeliveryByKey({
      tenantId,
      sessionKey: parsed.data.payload.session_key,
    });
    if (!focus) {
      return errorResponse(msg.request_id, msg.type, "not_found", "transcript session not found");
    }

    const workspaceId = focus.session.workspace_id;
    const { subagentRows, rootSessionKey, lineageKeys } = await loadLineageSubagentRows({
      deps,
      tenantId,
      workspaceId,
      focusSessionKey: focus.session.session_key,
    });
    const subagentBySessionKey = new Map(subagentRows.map((row) => [row.session_key, row]));
    const childRowsByParentKey = new Map<string, RawSubagentRow[]>();
    for (const row of subagentRows) {
      if (!row.parent_session_key) {
        continue;
      }
      const current = childRowsByParentKey.get(row.parent_session_key) ?? [];
      current.push(row);
      childRowsByParentKey.set(row.parent_session_key, current);
    }

    const seenKeys = new Set<string>(lineageKeys);

    const lineageSessions: SessionLineageRecord[] = [];
    for (const sessionKey of lineageKeys) {
      const loaded = await sessionDal.getWithDeliveryByKey({
        tenantId,
        sessionKey,
      });
      if (!loaded) {
        continue;
      }
      lineageSessions.push({
        sessionId: loaded.session.session_id,
        sessionKey: loaded.session.session_key,
        agentKey: loaded.agent_key,
        channel: loaded.connector_key,
        accountKey: loaded.account_key ?? null,
        threadId: loaded.provider_thread_id,
        containerKind: loaded.container_kind ?? null,
        title: loaded.session.title,
        messageCount: loaded.session.messages.length,
        updatedAt: loaded.session.updated_at,
        createdAt: loaded.session.created_at,
        archived: loaded.session.archived,
        messages: loaded.session.messages,
      });
    }

    const runDetailsByKey = await loadRunDetailsByKey({
      deps,
      tenantId,
      keys: lineageSessions.map((session) => session.sessionKey),
    });
    const summaries = buildTranscriptSessionSummaries({
      sessions: lineageSessions,
      subagentsBySessionKey: subagentBySessionKey,
      latestRunsByKey: buildLatestRunInfoByKey(runDetailsByKey),
      pendingApprovalsByKey: await loadPendingApprovalCountByKey({
        deps,
        tenantId,
        keys: lineageSessions.map((session) => session.sessionKey),
      }),
    });
    const summaryBySessionKey = new Map(summaries.map((summary) => [summary.session_key, summary]));

    const sessionKeyByRunId = new Map<string, string>();
    const stepIds: string[] = [];
    const attemptIds: string[] = [];
    const runIds: string[] = [];
    const events: TranscriptTimelineEvent[] = [];

    for (const session of lineageSessions) {
      const summary = summaryBySessionKey.get(session.sessionKey);
      for (const message of session.messages) {
        events.push({
          event_id: `message:${session.sessionKey}:${message.id}`,
          kind: "message",
          occurred_at: readMessageOccurredAt(message, session.updatedAt),
          session_key: session.sessionKey,
          parent_session_key: summary?.parent_session_key,
          subagent_id: summary?.subagent_id,
          payload: { message },
        });
      }
    }

    for (const [sessionKey, details] of runDetailsByKey) {
      const summary = summaryBySessionKey.get(sessionKey);
      for (const detail of details) {
        runIds.push(detail.run.run_id);
        sessionKeyByRunId.set(detail.run.run_id, sessionKey);
        for (const step of detail.steps) {
          stepIds.push(step.step_id);
        }
        for (const attempt of detail.attempts) {
          attemptIds.push(attempt.attempt_id);
        }
        events.push({
          event_id: `run:${detail.run.run_id}`,
          kind: "run",
          occurred_at: detail.run.created_at,
          session_key: sessionKey,
          parent_session_key: summary?.parent_session_key,
          subagent_id: summary?.subagent_id,
          payload: {
            run: detail.run,
            steps: detail.steps,
            attempts: detail.attempts,
          },
        });
      }
    }

    for (const row of subagentRows) {
      if (!seenKeys.has(row.session_key)) {
        continue;
      }
      const subagent = toSubagent(row);
      const summary = summaryBySessionKey.get(row.session_key);
      events.push({
        event_id: `subagent:${row.subagent_id}:spawned`,
        kind: "subagent",
        occurred_at: subagent.created_at,
        session_key: row.session_key,
        parent_session_key: summary?.parent_session_key,
        subagent_id: subagent.subagent_id,
        payload: {
          phase: "spawned",
          subagent,
        },
      });
      if (subagent.closed_at) {
        events.push({
          event_id: `subagent:${row.subagent_id}:closed`,
          kind: "subagent",
          occurred_at: subagent.closed_at,
          session_key: row.session_key,
          parent_session_key: summary?.parent_session_key,
          subagent_id: subagent.subagent_id,
          payload: {
            phase: "closed",
            subagent,
          },
        });
      }
    }

    events.push(
      ...(await resolveApprovalEvents({
        deps,
        tenantId,
        sessionIds: lineageSessions.map((session) => session.sessionId),
        sessionKeyByRunId,
        stepIds,
        attemptIds,
        runIds,
        summaryBySessionKey,
      })),
    );

    const result = WsTranscriptGetResult.parse({
      root_session_key: rootSessionKey,
      focus_session_key: focus.session.session_key,
      sessions: summaries,
      events: events.toSorted(compareTimelineEvents),
    });

    return {
      request_id: msg.request_id,
      type: msg.type,
      ok: true,
      result,
    };
  } catch (err) {
    return sessionErrorResponse({
      deps,
      err,
      msg,
      client,
      logEvent: "ws.transcript_get_failed",
      logFields: { session_key: parsed.data.payload.session_key },
    });
  }
}
