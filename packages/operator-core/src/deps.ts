import type {
  Approval,
  PairingListResponse,
  PairingMutateResponse,
  PresenceResponse,
  StatusResponse,
  UsageResponse,
  WsMemoryExportPayload,
  WsMemoryExportResult,
  WsMemoryForgetPayload,
  WsMemoryForgetResult,
  WsMemoryGetPayload,
  WsMemoryGetResult,
  WsMemoryListPayload,
  WsMemoryListResult,
  WsMemorySearchPayload,
  WsMemorySearchResult,
  WsMemoryUpdatePayload,
  WsMemoryUpdateResult,
} from "@tyrum/client";

export interface OperatorWsClient {
  readonly connected: boolean;
  connect(): void;
  disconnect(): void;
  on(event: string, handler: (data: unknown) => void): void;
  off(event: string, handler: (data: unknown) => void): void;
  approvalList(payload?: unknown): Promise<{ approvals: Approval[]; next_cursor?: string }>;
  approvalResolve(payload: unknown): Promise<{ approval: Approval }>;
  memorySearch(payload: WsMemorySearchPayload): Promise<WsMemorySearchResult>;
  memoryList(payload: WsMemoryListPayload): Promise<WsMemoryListResult>;
  memoryGet(payload: WsMemoryGetPayload): Promise<WsMemoryGetResult>;
  memoryUpdate(payload: WsMemoryUpdatePayload): Promise<WsMemoryUpdateResult>;
  memoryForget(payload: WsMemoryForgetPayload): Promise<WsMemoryForgetResult>;
  memoryExport(payload: WsMemoryExportPayload): Promise<WsMemoryExportResult>;
  commandExecute?(command: string, context?: unknown): Promise<unknown>;
}

export interface OperatorHttpClient {
  status: {
    get(options?: { signal?: AbortSignal }): Promise<StatusResponse>;
  };
  usage: {
    get(query?: unknown, options?: { signal?: AbortSignal }): Promise<UsageResponse>;
  };
  presence: {
    list(options?: { signal?: AbortSignal }): Promise<PresenceResponse>;
  };
  pairings: {
    list(query?: unknown, options?: { signal?: AbortSignal }): Promise<PairingListResponse>;
    approve(
      pairingId: number,
      input: unknown,
      options?: { signal?: AbortSignal },
    ): Promise<PairingMutateResponse>;
    deny(
      pairingId: number,
      input?: unknown,
      options?: { signal?: AbortSignal },
    ): Promise<PairingMutateResponse>;
    revoke(
      pairingId: number,
      input?: unknown,
      options?: { signal?: AbortSignal },
    ): Promise<PairingMutateResponse>;
  };
}
