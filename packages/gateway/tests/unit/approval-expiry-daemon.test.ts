import { describe, expect, it, vi } from "vitest";
import { ApprovalExpiryDaemon } from "../../src/modules/approval/expiry-daemon.js";

function mockApprovalDal(staleCount = 2) {
  return {
    expireStale: vi.fn().mockResolvedValue(staleCount),
    getById: vi.fn(),
    create: vi.fn(),
    respond: vi.fn(),
    getPending: vi.fn(),
    getByStatus: vi.fn(),
    getByPlanId: vi.fn(),
    expireById: vi.fn(),
  };
}

describe("ApprovalExpiryDaemon", () => {
  it("tick() calls expireStale and returns count", async () => {
    const dal = mockApprovalDal(3);
    const daemon = new ApprovalExpiryDaemon({ approvalDal: dal as never });
    const result = await daemon.tick();
    expect(dal.expireStale).toHaveBeenCalledOnce();
    expect(result).toBe(3);
  });

  it("unrefs the interval timer so it won't keep the process alive", () => {
    const dal = mockApprovalDal();
    const daemon = new ApprovalExpiryDaemon({ approvalDal: dal as never, intervalMs: 100_000 });

    const unref = vi.fn();
    const handle = { unref } as unknown as ReturnType<typeof setInterval>;

    const setIntervalSpy = vi
      .spyOn(globalThis, "setInterval")
      .mockReturnValue(handle as never);
    const clearIntervalSpy = vi
      .spyOn(globalThis, "clearInterval")
      .mockImplementation(() => {});

    try {
      daemon.start();
      expect(setIntervalSpy).toHaveBeenCalledOnce();
      expect(unref).toHaveBeenCalledOnce();
      daemon.stop();
      expect(clearIntervalSpy).toHaveBeenCalledWith(handle as never);
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });

  it("start/stop manages the interval timer", () => {
    const dal = mockApprovalDal();
    const daemon = new ApprovalExpiryDaemon({ approvalDal: dal as never, intervalMs: 100_000 });
    daemon.start();
    // Starting twice is idempotent
    daemon.start();
    daemon.stop();
    // Stopping twice is safe
    daemon.stop();
  });

  it("runs tick on interval", async () => {
    vi.useFakeTimers();
    const dal = mockApprovalDal(1);
    const daemon = new ApprovalExpiryDaemon({ approvalDal: dal as never, intervalMs: 100 });
    daemon.start();
    await vi.advanceTimersByTimeAsync(250);
    daemon.stop();
    vi.useRealTimers();
    expect(dal.expireStale.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
