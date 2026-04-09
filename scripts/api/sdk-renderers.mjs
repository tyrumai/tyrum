export function renderHttpGeneratedModules(httpCatalog) {
  return httpCatalog.runtimeModules.map((module) => ({
    path: module.generatedFile,
    content: module.content,
  }));
}

export function renderHttpGeneratedClient(httpCatalog) {
  const createImports = [];
  const createAssignments = [];

  for (const module of httpCatalog.runtimeModules) {
    if (module.createFunctionNames.length === 0) {
      continue;
    }
    createImports.push(
      `import { ${module.createFunctionNames.join(", ")} } from "./${module.moduleBaseName}.generated.js";`,
    );
    for (const functionName of module.createFunctionNames) {
      const apiName = functionName.slice("create".length, -3);
      createAssignments.push(
        `    ${apiName[0].toLowerCase()}${apiName.slice(1)}: ${functionName}(transport),`,
      );
    }
  }

  return [
    "// GENERATED: pnpm api:generate",
    "",
    'import { HttpTransport, type TyrumHttpClientOptions } from "../shared.js";',
    ...createImports.toSorted(),
    "",
    "export function createGeneratedTyrumHttpClient(options: TyrumHttpClientOptions) {",
    "  const transport = new HttpTransport(options);",
    "  return {",
    ...createAssignments.toSorted(),
    "  };",
    "}",
    "",
  ].join("\n");
}

export function renderWsClientGenerated(sourceText) {
  return `// GENERATED: pnpm api:generate\n\n${sourceText}`.replace(/\n{3,}/gu, "\n\n");
}

export function renderWsClientTypesSource() {
  return `import type {
  CapabilityDescriptor,
  ClientCapability,
  WsEvent as WsEventT,
  WsPeerRole,
  WsPlanUpdateEvent,
  WsTaskExecuteRequest,
} from "@tyrum/contracts";

// GENERATED: pnpm api:generate

type TyrumProtocolEvents = {
  [EventType in WsEventT["type"]]: Extract<WsEventT, { type: EventType }>;
};

export type TyrumClientProtocolErrorKind = "invalid_json" | "invalid_envelope";

export interface TyrumClientProtocolErrorInfo {
  kind: TyrumClientProtocolErrorKind;
  raw: string;
  error?: string;
  suppressedCount: number;
}

export type TyrumClientEvents = TyrumProtocolEvents & {
  connected: { clientId: string };
  disconnected: { code: number; reason: string };
  protocol_error: TyrumClientProtocolErrorInfo;
  reconnect_scheduled: { delayMs: number; nextRetryAtMs: number; attempt: number };
  transport_error: { message: string };
  task_execute: WsTaskExecuteRequest;
  plan_update: WsPlanUpdateEvent;
};

export interface TyrumClientOptions {
  url: string;
  token: string;
  tlsCertFingerprint256?: string;
  tlsCaCertPem?: string;
  capabilities: ClientCapability[];
  advertisedCapabilities?: CapabilityDescriptor[];
  role?: WsPeerRole;
  protocolRev?: number;
  device?: {
    publicKey: string;
    privateKey: string;
    deviceId?: string;
    label?: string;
    platform?: string;
    version?: string;
    mode?: string;
    device_type?: string;
    device_platform?: string;
  };
  reconnect?: boolean;
  reconnectBaseDelayMs?: number;
  maxReconnectDelay?: number;
  maxSeenEventIds?: number;
  maxSeenRequestIds?: number;
  debugProtocol?: boolean;
  onProtocolError?: (info: TyrumClientProtocolErrorInfo) => void;
}

export type ResolvedTyrumClientOptions = TyrumClientOptions & {
  reconnect: boolean;
  reconnectBaseDelayMs: number;
  maxReconnectDelay: number;
  maxSeenEventIds: number;
  maxSeenRequestIds: number;
  debugProtocol: boolean;
  role: WsPeerRole;
  protocolRev: number;
};
`;
}
