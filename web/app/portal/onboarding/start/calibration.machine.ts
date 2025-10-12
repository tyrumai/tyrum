import type {
  ConsentSelections,
  ConsentToggleKey,
} from "../../../api/onboarding/consent/store";

export const CALIBRATION_DURATION_SECONDS = 90;

export const CALIBRATION_STEP_IDS = [
  "tone",
  "verbosity",
  "initiative",
  "quietHours",
  "spending",
  "voice",
  "consent",
] as const;

export type CalibrationStepId = (typeof CALIBRATION_STEP_IDS)[number];
export type PersonaStepId = Exclude<CalibrationStepId, "consent">;

export type PersonaSelections = {
  tone?: string;
  verbosity?: string;
  initiative?: string;
  quietHours?: string;
  spending?: string;
  voice?: string;
};

export type CalibrationSubmission = {
  auditReference: string;
  revision: number;
};

export type CalibrationStatus =
  | "idle"
  | "collecting"
  | "review"
  | "submitting"
  | "success"
  | "expired";

export type CalibrationState = {
  status: CalibrationStatus;
  stepIndex: number;
  startedAt: number | null;
  completedAt: number | null;
  elapsedSeconds: number;
  persona: PersonaSelections;
  consent: ConsentSelections;
  submission: CalibrationSubmission | null;
  error: string | null;
};

export type StartEvent = {
  type: "start";
  now: number;
};

export type TickEvent = {
  type: "tick";
  now: number;
};

export type UpdatePersonaEvent = {
  type: "update_persona";
  step: CalibrationStepId;
  value: string;
};

export type SetConsentEvent = {
  type: "set_consent";
  key: ConsentToggleKey;
  value: boolean;
};

export type AdvanceEvent = {
  type: "advance";
};

export type BackEvent = {
  type: "back";
};

export type SubmitEvent = {
  type: "submit";
};

export type SubmitSuccessEvent = {
  type: "submit_success";
  submission: CalibrationSubmission;
  completedAt: number;
};

export type SubmitFailureEvent = {
  type: "submit_failure";
  message: string;
};

export type ResetEvent = {
  type: "reset";
};

export type CalibrationEvent =
  | StartEvent
  | TickEvent
  | UpdatePersonaEvent
  | SetConsentEvent
  | AdvanceEvent
  | BackEvent
  | SubmitEvent
  | SubmitSuccessEvent
  | SubmitFailureEvent
  | ResetEvent;

const INITIAL_CONSENT: ConsentSelections = {
  shareCalendarSignals: false,
  allowPlannerAutonomy: false,
  retainAuditTrail: false,
};

const LAST_STEP_INDEX = CALIBRATION_STEP_IDS.length - 1;

export function createInitialCalibrationState(): CalibrationState {
  return {
    status: "idle",
    stepIndex: -1,
    startedAt: null,
    completedAt: null,
    elapsedSeconds: 0,
    persona: {},
    consent: { ...INITIAL_CONSENT },
    submission: null,
    error: null,
  };
}

function clampElapsedSeconds(elapsed: number) {
  if (elapsed < 0) {
    return 0;
  }

  if (elapsed > CALIBRATION_DURATION_SECONDS) {
    return CALIBRATION_DURATION_SECONDS;
  }

  return elapsed;
}

function computeElapsedSeconds(startedAt: number | null, now: number) {
  if (!startedAt) {
    return 0;
  }

  const elapsed = Math.floor((now - startedAt) / 1000);
  return clampElapsedSeconds(elapsed);
}

export function calibrationReducer(
  state: CalibrationState,
  event: CalibrationEvent,
): CalibrationState {
  switch (event.type) {
    case "start": {
      if (state.status !== "idle") {
        return state;
      }

      return {
        ...state,
        status: "collecting",
        stepIndex: 0,
        startedAt: event.now,
        completedAt: null,
        elapsedSeconds: 0,
        submission: null,
        error: null,
        persona: {},
        consent: { ...INITIAL_CONSENT },
      };
    }
    case "tick": {
      if (!state.startedAt) {
        return state;
      }

      const status = state.status;

      if (!(status === "collecting" || status === "review" || status === "submitting" || status === "success")) {
        return state;
      }

      const elapsedSeconds = computeElapsedSeconds(state.startedAt, event.now);

      if (elapsedSeconds >= CALIBRATION_DURATION_SECONDS) {
        if (status === "submitting" || status === "success") {
          return {
            ...state,
            elapsedSeconds,
          };
        }

        return {
          ...state,
          status: "expired",
          elapsedSeconds,
          completedAt: state.completedAt ?? event.now,
          error: null,
        };
      }

      return {
        ...state,
        elapsedSeconds,
      };
    }
    case "update_persona": {
      if (state.status !== "collecting" && state.status !== "review") {
        return state;
      }

      if (event.step === "consent") {
        return state;
      }

      return {
        ...state,
        persona: {
          ...state.persona,
          [event.step]: event.value,
        },
        error: null,
      };
    }
    case "set_consent": {
      if (state.status !== "collecting" && state.status !== "review") {
        return state;
      }

      return {
        ...state,
        consent: {
          ...state.consent,
          [event.key]: event.value,
        },
        error: null,
      };
    }
    case "advance": {
      if (state.status !== "collecting") {
        return state;
      }

      if (state.stepIndex >= LAST_STEP_INDEX) {
        return {
          ...state,
          status: "review",
          error: null,
        };
      }

      return {
        ...state,
        stepIndex: state.stepIndex + 1,
        error: null,
      };
    }
    case "back": {
      if (state.status === "review") {
        return {
          ...state,
          status: "collecting",
          stepIndex: LAST_STEP_INDEX,
          error: null,
        };
      }

      if (state.status !== "collecting" || state.stepIndex <= 0) {
        return state;
      }

      return {
        ...state,
        stepIndex: state.stepIndex - 1,
        error: null,
      };
    }
    case "submit": {
      if (state.status !== "review") {
        return state;
      }

      return {
        ...state,
        status: "submitting",
        error: null,
      };
    }
    case "submit_success": {
      if (state.status !== "submitting") {
        return state;
      }

      const elapsedSeconds = state.startedAt
        ? clampElapsedSeconds(Math.floor((event.completedAt - state.startedAt) / 1000))
        : state.elapsedSeconds;

      return {
        ...state,
        status: "success",
        submission: event.submission,
        completedAt: event.completedAt,
        elapsedSeconds,
        error: null,
      };
    }
    case "submit_failure": {
      if (state.status !== "submitting") {
        return state;
      }

      return {
        ...state,
        status: "review",
        error: event.message,
      };
    }
    case "reset": {
      return {
        ...createInitialCalibrationState(),
      };
    }
    default:
      return state;
  }
}

export function isPersonaStep(step: CalibrationStepId): step is PersonaStepId {
  return step !== "consent";
}

export function isStepComplete(
  state: CalibrationState,
  step: CalibrationStepId,
): boolean {
  if (step === "consent") {
    return Object.values(state.consent).some(Boolean);
  }

  return Boolean(state.persona[step]);
}

export function canAdvanceFromCurrentStep(state: CalibrationState) {
  if (state.status !== "collecting") {
    return false;
  }

  const currentStep = CALIBRATION_STEP_IDS[state.stepIndex];
  if (!currentStep) {
    return false;
  }

  return isStepComplete(state, currentStep);
}

export function remainingSeconds(state: CalibrationState) {
  const remaining = CALIBRATION_DURATION_SECONDS - state.elapsedSeconds;
  return remaining > 0 ? remaining : 0;
}

export function isExpired(state: CalibrationState) {
  return state.status === "expired";
}

export function hasCompletedAllPersonaFields(state: CalibrationState) {
  return CALIBRATION_STEP_IDS.every((step) => isStepComplete(state, step));
}
