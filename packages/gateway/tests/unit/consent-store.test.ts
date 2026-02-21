import { beforeEach, describe, expect, it } from "vitest";
import {
  snapshotConsent,
  persistConsent,
  resetConsentStore,
  isConsentSelections,
  isCalibrationSnapshot,
} from "../../src/modules/web/consent-store.js";
import type {
  ConsentSelections,
  CalibrationSnapshot,
} from "../../src/modules/web/consent-store.js";

describe("consent-store", () => {
  beforeEach(() => {
    resetConsentStore();
  });

  const validSelections: ConsentSelections = {
    shareCalendarSignals: true,
    allowPlannerAutonomy: false,
    retainAuditTrail: true,
  };

  const validCalibration: CalibrationSnapshot = {
    persona: { tone: "formal", verbosity: "concise" },
    startedAt: "2025-01-20T09:00:00.000Z",
    completedAt: "2025-01-20T09:05:00.000Z",
    durationSeconds: 300,
  };

  describe("snapshotConsent", () => {
    it("returns default when no record persisted", () => {
      const record = snapshotConsent();
      expect(record.revision).toBe(0);
      expect(record.selections).toEqual({
        shareCalendarSignals: false,
        allowPlannerAutonomy: false,
        retainAuditTrail: false,
      });
      expect(record.calibration).toBeUndefined();
      expect(record.stub.persistence).toBe("memory");
    });
  });

  describe("persistConsent", () => {
    it("creates first record with revision 1", () => {
      const record = persistConsent(validSelections);
      expect(record.revision).toBe(1);
      expect(record.selections).toEqual(validSelections);
      expect(record.auditReference).toBe("CONSENT-STUB-0001");
    });

    it("increments revision on subsequent calls", () => {
      persistConsent(validSelections);
      const second = persistConsent(validSelections);
      expect(second.revision).toBe(2);
      expect(second.auditReference).toBe("CONSENT-STUB-0001-R02");

      const third = persistConsent(validSelections);
      expect(third.revision).toBe(3);
      expect(third.auditReference).toBe("CONSENT-STUB-0001-R03");
    });

    it("stores calibration when provided", () => {
      const record = persistConsent(validSelections, validCalibration);
      expect(record.calibration).toEqual(validCalibration);
    });
  });

  describe("resetConsentStore", () => {
    it("resets to default state", () => {
      persistConsent(validSelections, validCalibration);
      resetConsentStore();
      const record = snapshotConsent();
      expect(record.revision).toBe(0);
      expect(record.calibration).toBeUndefined();
    });
  });

  describe("isConsentSelections", () => {
    it("returns true for valid selections", () => {
      expect(isConsentSelections(validSelections)).toBe(true);
    });

    it("returns false for missing keys", () => {
      expect(
        isConsentSelections({ shareCalendarSignals: true, allowPlannerAutonomy: false }),
      ).toBe(false);
    });

    it("returns false for non-boolean values", () => {
      expect(
        isConsentSelections({
          shareCalendarSignals: "yes",
          allowPlannerAutonomy: false,
          retainAuditTrail: true,
        }),
      ).toBe(false);
    });

    it("returns false for null", () => {
      expect(isConsentSelections(null)).toBe(false);
    });

    it("returns false for non-object", () => {
      expect(isConsentSelections("string")).toBe(false);
      expect(isConsentSelections(42)).toBe(false);
      expect(isConsentSelections(undefined)).toBe(false);
    });
  });

  describe("isCalibrationSnapshot", () => {
    it("returns true for valid snapshot", () => {
      expect(isCalibrationSnapshot(validCalibration)).toBe(true);
    });

    it("returns true for snapshot with zero duration", () => {
      expect(
        isCalibrationSnapshot({ ...validCalibration, durationSeconds: 0 }),
      ).toBe(true);
    });

    it("returns false for missing fields", () => {
      expect(
        isCalibrationSnapshot({ persona: { tone: "formal" }, startedAt: "2025-01-20T09:00:00.000Z" }),
      ).toBe(false);
    });

    it("returns false for invalid dates", () => {
      expect(
        isCalibrationSnapshot({
          ...validCalibration,
          startedAt: "not-a-date",
        }),
      ).toBe(false);
    });

    it("returns false for negative duration", () => {
      expect(
        isCalibrationSnapshot({
          ...validCalibration,
          durationSeconds: -1,
        }),
      ).toBe(false);
    });

    it("returns false for non-object", () => {
      expect(isCalibrationSnapshot(null)).toBe(false);
      expect(isCalibrationSnapshot("string")).toBe(false);
      expect(isCalibrationSnapshot(42)).toBe(false);
    });
  });
});
