#![allow(clippy::expect_used, clippy::unwrap_used)]

mod common;

use chrono::Utc;
use common::postgres::{TestPostgres, docker_available};
use serde_json::{Map as JsonMap, Value, json};
use tyrum_memory::MemoryDal;
use tyrum_planner::{
    AppendOutcome, EventLog, NewPlannerEvent,
    replay::{ReplayMetrics, ReplaySandbox},
};
use tyrum_shared::{ActionArguments, ActionPrimitive, ActionPrimitiveKind};
use uuid::Uuid;

#[tokio::test]
async fn replay_succeeds_for_matching_trace() {
    if !docker_available() {
        eprintln!("skipping replay_succeeds_for_matching_trace: docker unavailable");
        return;
    }

    let postgres = TestPostgres::start().await.expect("start postgres fixture");
    let pool = postgres.pool().clone();

    let event_log = EventLog::from_pool(pool.clone());
    event_log.migrate().await.expect("run planner migrations");
    let memory = MemoryDal::new(pool.clone());

    let plan_id = Uuid::new_v4();
    let subject_id = Uuid::new_v4();
    seed_plan_trace(&event_log, plan_id, |primitive, _| match primitive.kind {
        ActionPrimitiveKind::Confirm => json!({ "decision": "approved" }),
        ActionPrimitiveKind::Web => primitive
            .postcondition
            .as_ref()
            .cloned()
            .expect("web primitive requires postcondition"),
        ActionPrimitiveKind::Message => json!({
            "status": "delivered",
            "channel": primitive
                .args
                .get("channel")
                .and_then(Value::as_str)
                .unwrap_or("email"),
        }),
        _ => Value::Null,
    })
    .await;

    let sandbox = ReplaySandbox::new(event_log, memory.clone(), ReplayMetrics::default());
    let report = sandbox
        .replay_plan(plan_id, Some(subject_id))
        .await
        .expect("replay plan");

    assert!(report.succeeded());
    assert_eq!(report.steps_replayed, 3);

    let episodic = memory
        .list_episodic_events_for_subject(subject_id)
        .await
        .expect("list episodic events");
    assert_eq!(
        episodic.len(),
        3,
        "stub executors should emit episodic events"
    );

    let facts = memory
        .list_facts_for_subject(subject_id)
        .await
        .expect("list capability facts");
    assert_eq!(facts.len(), 1);
}

#[tokio::test]
async fn replay_detects_mismatch_and_reports_diff() {
    if !docker_available() {
        eprintln!("skipping replay_detects_mismatch_and_reports_diff: docker unavailable");
        return;
    }

    let postgres = TestPostgres::start().await.expect("start postgres fixture");
    let pool = postgres.pool().clone();

    let event_log = EventLog::from_pool(pool.clone());
    event_log.migrate().await.expect("run planner migrations");
    let memory = MemoryDal::new(pool.clone());

    let plan_id = Uuid::new_v4();
    let subject_id = Uuid::new_v4();
    seed_plan_trace(&event_log, plan_id, |primitive, step_index| {
        if primitive.kind == ActionPrimitiveKind::Message && step_index == 2 {
            json!({
                "status": "failed",
                "channel": primitive
                    .args
                    .get("channel")
                    .and_then(Value::as_str)
                    .unwrap_or("email"),
            })
        } else {
            match primitive.kind {
                ActionPrimitiveKind::Confirm => json!({ "decision": "approved" }),
                ActionPrimitiveKind::Web => primitive
                    .postcondition
                    .as_ref()
                    .cloned()
                    .expect("web primitive requires postcondition"),
                ActionPrimitiveKind::Message => json!({
                    "status": "delivered",
                    "channel": primitive
                        .args
                        .get("channel")
                        .and_then(Value::as_str)
                        .unwrap_or("email"),
                }),
                _ => Value::Null,
            }
        }
    })
    .await;

    let sandbox = ReplaySandbox::new(event_log, memory, ReplayMetrics::default());
    let report = sandbox
        .replay_plan(plan_id, Some(subject_id))
        .await
        .expect("replay plan");

    assert!(!report.succeeded());
    assert_eq!(report.steps_replayed, 3);
    assert_eq!(report.mismatches.len(), 1);
    let mismatch = &report.mismatches[0];
    assert_eq!(mismatch.step_index, 2);
    assert_eq!(mismatch.primitive.kind, ActionPrimitiveKind::Message);
    assert!(
        mismatch.diffs.iter().any(|diff| diff.path == "/status"),
        "diff should include message status change"
    );
}

async fn seed_plan_trace<F>(event_log: &EventLog, plan_id: Uuid, mut result_fn: F)
where
    F: FnMut(&ActionPrimitive, usize) -> Value,
{
    let steps = build_sample_plan();
    for (index, primitive) in steps.iter().enumerate() {
        let executor = match primitive.kind {
            ActionPrimitiveKind::Confirm => "human",
            ActionPrimitiveKind::Web => primitive
                .args
                .get("executor")
                .and_then(Value::as_str)
                .unwrap_or("generic-web"),
            ActionPrimitiveKind::Message => "generic-message",
            _ => "unknown",
        };
        let payload = json!({
            "primitive": primitive,
            "executor": executor,
            "result": result_fn(primitive, index),
        });
        let step_index =
            i32::try_from(index).expect("plan steps must fit within 32-bit signed indices");
        let event = NewPlannerEvent::from_payload(
            Uuid::new_v4(),
            plan_id,
            step_index,
            Utc::now(),
            &payload,
        )
        .expect("encode planner event");
        match event_log.append(event).await.expect("append planner event") {
            AppendOutcome::Inserted(_) => {}
            AppendOutcome::Duplicate => panic!("unexpected duplicate step {index}"),
        }
    }
}

fn build_sample_plan() -> Vec<ActionPrimitive> {
    let slot = json!({
        "start": "2025-10-18T15:00:00Z",
        "end": "2025-10-18T15:30:00Z",
        "with": "Alex Doe",
    });

    vec![
        ActionPrimitive::new(
            ActionPrimitiveKind::Confirm,
            into_args(json!({
                "prompt": "Book call with Alex on Oct 18 at 15:00 UTC?",
                "context": { "slot": slot.clone() },
            })),
        ),
        ActionPrimitive::new(
            ActionPrimitiveKind::Web,
            into_args(json!({
                "executor": "generic-web",
                "intent": "book_call",
                "url": "https://calendar.example.com/slots",
                "slot": slot.clone(),
            })),
        )
        .with_postcondition(json!({
            "assertions": [
                { "type": "dom_contains", "text": "booked", "case_insensitive": true }
            ],
            "metadata": {
                "appointment": {
                    "status": "booked",
                    "slot": slot.clone(),
                }
            }
        })),
        ActionPrimitive::new(
            ActionPrimitiveKind::Message,
            into_args(json!({
                "channel": "email",
                "recipient": "alex@example.com",
                "body": "Confirmed call for Oct 18 at 15:00 UTC.",
            })),
        )
        .with_postcondition(json!({
            "status": "delivered",
            "channel": "email",
        })),
    ]
}

fn into_args(value: Value) -> ActionArguments {
    match value {
        Value::Object(map) => map,
        other => {
            let mut map = JsonMap::new();
            map.insert("value".into(), other);
            map
        }
    }
}
