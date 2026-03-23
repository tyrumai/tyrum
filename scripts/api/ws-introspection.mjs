import { readFile } from "node:fs/promises";
import { buildContractSchemaResolver } from "./contracts-resolver.mjs";
import { WS_SERVER_INITIATED_REQUEST_TYPES, wsClientSourcePath } from "./paths.mjs";

const WS_EXCLUDED_REQUEST_TYPES = new Set(["connect"]);

function summarizeWsMessage(type) {
  return `${type} WebSocket message`;
}

function resolveWsScopes(type) {
  switch (type) {
    case "approval.list":
      return ["operator.read"];
    case "approval.resolve":
      return ["operator.approvals"];
    case "pairing.approve":
    case "pairing.deny":
    case "pairing.revoke":
      return ["operator.pairing"];
    case "command.execute":
      return ["operator.admin"];
    case "chat.session.send":
    case "chat.session.create":
    case "chat.session.delete":
    case "chat.session.queue_mode.set":
    case "workflow.run":
    case "workflow.resume":
    case "workflow.cancel":
    case "work.create":
    case "work.update":
    case "work.delete":
    case "work.transition":
    case "work.pause":
    case "work.resume":
    case "work.link.create":
    case "subagent.spawn":
    case "subagent.send":
    case "subagent.close":
    case "work.artifact.create":
    case "work.decision.create":
    case "work.signal.create":
    case "work.signal.update":
    case "work.state_kv.set":
      return ["operator.write"];
    case "chat.session.list":
    case "chat.session.get":
    case "chat.session.reconnect":
    case "transcript.list":
    case "transcript.get":
    case "run.list":
    case "work.list":
    case "work.get":
    case "subagent.list":
    case "subagent.get":
    case "work.artifact.list":
    case "work.artifact.get":
    case "work.link.list":
    case "work.decision.list":
    case "work.decision.get":
    case "work.signal.list":
    case "work.signal.get":
    case "work.state_kv.get":
    case "work.state_kv.list":
      return ["operator.read"];
    case "presence.beacon":
    case "location.beacon":
    case "ping":
      return [];
    default:
      return null;
  }
}

export async function extractWsCatalog() {
  const resolver = await buildContractSchemaResolver();
  const schemas = await resolver.listSchemas();
  const requests = [];
  const responsesByType = new Map();
  const events = [];

  for (const entry of schemas) {
    const schema = entry.schema;
    const typeConst = schema?.properties?.type?.const;
    if (typeof typeConst !== "string") continue;
    const properties = schema.properties ?? {};
    const hasEventId = Object.hasOwn(properties, "event_id");
    const hasRequestId = Object.hasOwn(properties, "request_id");
    const hasOk = Object.hasOwn(properties, "ok");

    if (hasEventId) {
      events.push({
        type: typeConst,
        schemaName: entry.name,
        summary: summarizeWsMessage(typeConst),
      });
      continue;
    }

    if (hasRequestId && !hasOk) {
      if (WS_EXCLUDED_REQUEST_TYPES.has(typeConst)) {
        continue;
      }
      requests.push({
        type: typeConst,
        schemaName: entry.name,
        summary: summarizeWsMessage(typeConst),
        scopes: resolveWsScopes(typeConst),
        direction: WS_SERVER_INITIATED_REQUEST_TYPES.has(typeConst)
          ? "server_to_client"
          : "client_to_server",
      });
      continue;
    }

    if (hasRequestId && hasOk) {
      const bucket = responsesByType.get(typeConst) ?? [];
      bucket.push(entry.name);
      responsesByType.set(typeConst, bucket);
    }
  }

  const sortedRequests = requests.toSorted((a, b) => a.type.localeCompare(b.type));
  const sortedEvents = events.toSorted((a, b) => a.type.localeCompare(b.type));
  for (const request of sortedRequests) {
    request.responseSchemaNames = (responsesByType.get(request.type) ?? []).toSorted();
  }
  return { requests: sortedRequests, events: sortedEvents };
}

export async function readWsClientTemplate() {
  return await readFile(wsClientSourcePath, "utf8");
}
