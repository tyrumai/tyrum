import type { TelegramPollingStateDal } from "./telegram-polling-state-dal.js";

export class TelegramPollingWorkerLeaseLostError extends Error {
  constructor() {
    super("Telegram polling worker lease was lost");
    this.name = "TelegramPollingWorkerLeaseLostError";
  }
}

export type TelegramPollingLeaseHeartbeat = {
  stop(): Promise<void>;
  throwIfLeaseLost(): void;
};

export function startTelegramPollingLeaseHeartbeat(input: {
  tenantId: string;
  accountKey: string;
  owner: string;
  stateDal: TelegramPollingStateDal;
  leaseTtlMs: number;
  abort(): void;
}): TelegramPollingLeaseHeartbeat {
  const heartbeatIntervalMs = Math.max(5, Math.floor(input.leaseTtlMs / 3));
  let stopped = false;
  let lostLease = false;
  let heartbeatError: Error | null = null;
  let renewPromise: Promise<void> | null = null;

  const renewLease = async (): Promise<void> => {
    if (stopped || lostLease || heartbeatError) {
      return;
    }
    const renewed = await input.stateDal.renewLease({
      tenantId: input.tenantId,
      accountKey: input.accountKey,
      owner: input.owner,
      nowMs: Date.now(),
      leaseTtlMs: input.leaseTtlMs,
    });
    if (!renewed) {
      lostLease = true;
      input.abort();
    }
  };

  const timer = setInterval(() => {
    if (renewPromise || stopped || lostLease || heartbeatError) {
      return;
    }
    renewPromise = renewLease()
      .catch((err: unknown) => {
        heartbeatError = err instanceof Error ? err : new Error(String(err));
        input.abort();
      })
      .finally(() => {
        renewPromise = null;
      });
  }, heartbeatIntervalMs);
  timer.unref?.();

  const throwIfLeaseLost = (): void => {
    if (heartbeatError) {
      throw heartbeatError;
    }
    if (lostLease) {
      throw new TelegramPollingWorkerLeaseLostError();
    }
  };

  return {
    async stop(): Promise<void> {
      stopped = true;
      clearInterval(timer);
      await renewPromise;
      throwIfLeaseLost();
    },
    throwIfLeaseLost,
  };
}
