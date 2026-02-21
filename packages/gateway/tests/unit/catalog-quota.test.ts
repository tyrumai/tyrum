import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ModelCatalogService } from "../../src/modules/model/catalog-service.js";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("ModelCatalogService quota", () => {
  let service: ModelCatalogService;
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "catalog-quota-test-"));
    service = new ModelCatalogService({ cacheDir });
  });

  describe("updateQuotaFromHeaders", () => {
    it("parses all rate-limit headers", () => {
      const headers = new Headers({
        "x-ratelimit-remaining": "42",
        "x-ratelimit-limit": "100",
        "retry-after": "30",
      });

      service.updateQuotaFromHeaders("gpt-4", headers);
      const info = service.getQuotaInfo("gpt-4");

      expect(info).toBeDefined();
      expect(info!.modelId).toBe("gpt-4");
      expect(info!.remaining).toBe(42);
      expect(info!.limit).toBe(100);
      expect(info!.retryAfterSeconds).toBe(30);
    });

    it("handles partial headers", () => {
      const headers = new Headers({
        "x-ratelimit-remaining": "10",
      });

      service.updateQuotaFromHeaders("claude-3", headers);
      const info = service.getQuotaInfo("claude-3");

      expect(info).toBeDefined();
      expect(info!.remaining).toBe(10);
      expect(info!.limit).toBeUndefined();
      expect(info!.retryAfterSeconds).toBeUndefined();
    });

    it("no-ops when no rate-limit headers present", () => {
      const headers = new Headers({
        "content-type": "application/json",
      });

      service.updateQuotaFromHeaders("gpt-4", headers);
      const info = service.getQuotaInfo("gpt-4");

      expect(info).toBeUndefined();
    });

    it("handles non-numeric header values gracefully", () => {
      const headers = new Headers({
        "x-ratelimit-remaining": "not-a-number",
        "x-ratelimit-limit": "100",
      });

      service.updateQuotaFromHeaders("gpt-4", headers);
      const info = service.getQuotaInfo("gpt-4");

      expect(info).toBeDefined();
      expect(info!.remaining).toBeUndefined();
      expect(info!.limit).toBe(100);
    });
  });

  describe("getQuotaInfo", () => {
    it("returns undefined for unknown model", () => {
      expect(service.getQuotaInfo("unknown-model")).toBeUndefined();
    });

    it("expires cached quota after TTL", () => {
      vi.useFakeTimers();

      const headers = new Headers({
        "x-ratelimit-remaining": "50",
      });
      service.updateQuotaFromHeaders("gpt-4", headers);

      expect(service.getQuotaInfo("gpt-4")).toBeDefined();

      // Advance past TTL (60 seconds)
      vi.advanceTimersByTime(61_000);

      expect(service.getQuotaInfo("gpt-4")).toBeUndefined();

      vi.useRealTimers();
    });

    it("returns fresh quota within TTL", () => {
      vi.useFakeTimers();

      const headers = new Headers({
        "x-ratelimit-remaining": "50",
      });
      service.updateQuotaFromHeaders("gpt-4", headers);

      // Advance less than TTL
      vi.advanceTimersByTime(30_000);

      const info = service.getQuotaInfo("gpt-4");
      expect(info).toBeDefined();
      expect(info!.remaining).toBe(50);

      vi.useRealTimers();
    });
  });
});
