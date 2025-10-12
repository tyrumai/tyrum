export const planTimelineFixture = {
  plan_id: "3a1c9f77-2f6b-4f2f-a1a3-bc9471d8e852",
  generated_at: "2025-10-08T18:00:12.142Z",
  event_count: 2,
  has_redactions: true,
  events: [
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
  ],
};
