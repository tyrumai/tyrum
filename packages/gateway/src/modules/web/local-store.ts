export type StoredProfile = {
  profile_id: string;
  version: string;
  profile: Record<string, unknown>;
};

export type IntegrationPreference = {
  slug: string;
  name: string;
  description: string;
  enabled: boolean;
};

export type TimelineEvent = {
  replay_id: string;
  step_index: number;
  occurred_at: string;
  recorded_at: string;
  action: Record<string, unknown>;
  voice_rationale?: string;
  redactions: string[];
};

export type PlanTimeline = {
  plan_id: string;
  generated_at: string;
  event_count: number;
  has_redactions: boolean;
  events: TimelineEvent[];
};

const DEFAULT_ACCOUNT_ID = "single-user-local";

const DEFAULT_INTEGRATIONS: IntegrationPreference[] = [
  {
    slug: "calendar-suite",
    name: "Calendar Suite",
    description: "Sync meetings and hold buffers across your calendars.",
    enabled: false,
  },
  {
    slug: "expense-forwarders",
    name: "Expense Forwarders",
    description: "Route receipts and approvals into the planner spend controls.",
    enabled: true,
  },
];

const DEFAULT_TIMELINE_PLAN_ID = "3a1c9f77-2f6b-4f2f-a1a3-bc9471d8e852";
const DEFAULT_TIMELINE_EVENTS: TimelineEvent[] = [
  {
    replay_id: "b91a7a90-239a-4f6e-9ad4-2a089dfb67d8",
    step_index: 0,
    occurred_at: "2025-10-08T17:58:54.327Z",
    recorded_at: "2025-10-08T17:58:54.521Z",
    action: {
      kind: "executor_result",
      executor: "generic-web",
      result: {
        status: "success",
        detail: "[redacted]",
      },
    },
    voice_rationale: "[redacted]",
    redactions: ["/action/result/detail"],
  },
  {
    replay_id: "e5129e54-4370-48af-8941-891d0d9751b3",
    step_index: 1,
    occurred_at: "2025-10-08T17:59:12.927Z",
    recorded_at: "2025-10-08T17:59:13.021Z",
    action: {
      kind: "plan_summary",
      executor: "planner",
      result: {
        status: "success",
        notes: "Postconditions satisfied for all steps.",
      },
    },
    voice_rationale: "Planner compiled summary for playback.",
    redactions: [],
  },
];

const timelines = new Map<string, PlanTimeline>([
  [
    DEFAULT_TIMELINE_PLAN_ID,
    {
      plan_id: DEFAULT_TIMELINE_PLAN_ID,
      generated_at: "2025-10-08T18:00:12.142Z",
      event_count: DEFAULT_TIMELINE_EVENTS.length,
      has_redactions: true,
      events: DEFAULT_TIMELINE_EVENTS,
    },
  ],
]);

let pamRevision = 0;
let pvpRevision = 0;
let pamProfile: StoredProfile | null = null;
let pvpProfile: StoredProfile | null = null;
let integrations: IntegrationPreference[] = structuredClone(DEFAULT_INTEGRATIONS);

function nextVersion(prefix: "pam" | "pvp", revision: number): string {
  return `${prefix}-v${String(revision).padStart(4, "0")}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function readProfiles() {
  return {
    pam: pamProfile ? clone(pamProfile) : null,
    pvp: pvpProfile ? clone(pvpProfile) : null,
  };
}

export function savePamProfile(profile: Record<string, unknown>) {
  pamRevision += 1;
  const version = nextVersion("pam", pamRevision);
  pamProfile = {
    profile_id: "pam-default",
    version,
    profile: clone(profile),
  };
  return clone(pamProfile);
}

export function savePvpProfile(profile: Record<string, unknown>) {
  pvpRevision += 1;
  const version = nextVersion("pvp", pvpRevision);
  pvpProfile = {
    profile_id: "pvp-default",
    version,
    profile: clone(profile),
  };
  return clone(pvpProfile);
}

export function previewVoice() {
  return {
    audio_base64: "ZmFrZS1hdWRpby1kYXRh",
    format: "wav",
  };
}

export function listIntegrations() {
  return {
    account_id: DEFAULT_ACCOUNT_ID,
    integrations: clone(integrations),
  };
}

export function setIntegrationPreference(slug: string, enabled: boolean) {
  const integration = integrations.find((entry) => entry.slug === slug);
  if (!integration) {
    return undefined;
  }

  integration.enabled = enabled;
  return clone(integration);
}

export function getPlanTimeline(planId: string) {
  const timeline = timelines.get(planId);
  if (!timeline) {
    return undefined;
  }
  return clone(timeline);
}

export function buildAuditTaskResponse(action: "export" | "delete") {
  const tasks = {
    export: {
      id: "export-task-stub",
      type: "account_export",
      auditReference: "AUDIT-EXPORT-0001",
      etaSeconds: 120,
      enqueuedAt: "2025-01-15T11:00:00.000Z",
    },
    delete: {
      id: "delete-task-stub",
      type: "account_delete",
      auditReference: "AUDIT-DELETE-0001",
      etaSeconds: 43200,
      enqueuedAt: "2025-01-16T08:00:00.000Z",
    },
  } as const;

  return {
    status: "enqueued",
    task: tasks[action],
  };
}

export function resetLocalStoreForTesting() {
  pamRevision = 0;
  pvpRevision = 0;
  pamProfile = null;
  pvpProfile = null;
  integrations = clone(DEFAULT_INTEGRATIONS);
  timelines.clear();
  timelines.set(DEFAULT_TIMELINE_PLAN_ID, {
    plan_id: DEFAULT_TIMELINE_PLAN_ID,
    generated_at: "2025-10-08T18:00:12.142Z",
    event_count: DEFAULT_TIMELINE_EVENTS.length,
    has_redactions: true,
    events: clone(DEFAULT_TIMELINE_EVENTS),
  });
}
