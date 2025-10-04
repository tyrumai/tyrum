mod common;

use anyhow::{Context, Result, bail};
use chrono::Utc;
use common::postgres::TestPostgres;
use serde_json::{Value, json};
use tyrum_memory::{MemoryDal, NewEpisodicEvent, NewFact};
use tyrum_planner::{
    ActionArguments, ActionPrimitive, ActionPrimitiveKind, AppendOutcome, EventLog,
    NewPlannerEvent, PlanEvent, PlanStateMachine, PlanStatus,
};
use uuid::Uuid;

#[tokio::test(flavor = "multi_thread")]
async fn mock_book_call_plan_creates_audit_and_memory_artifacts() -> Result<()> {
    let postgres = TestPostgres::start()
        .await
        .context("start postgres fixture")?;
    let pool = postgres.pool().clone();

    let event_log = EventLog::from_pool(pool.clone());
    event_log
        .migrate()
        .await
        .context("migrate planner schema")?;

    let memory = MemoryDal::new(pool.clone());

    let subject_id = Uuid::new_v4();
    let plan_id = Uuid::new_v4();
    let call_slot = json!({
        "start": "2025-10-18T15:00:00Z",
        "end": "2025-10-18T15:30:00Z",
        "with": "Alex Doe",
    });

    let plan_steps = vec![
        ActionPrimitive::new(
            ActionPrimitiveKind::Confirm,
            into_args(json!({
                "prompt": "Book call with Alex on Oct 18 at 15:00 UTC?",
                "context": { "slot": call_slot.clone() },
            })),
        ),
        ActionPrimitive::new(
            ActionPrimitiveKind::Web,
            into_args(json!({
                "executor": "generic-web",
                "intent": "book_call",
                "url": "https://calendar.example.com/slots",
                "slot": call_slot.clone(),
            })),
        )
        .with_postcondition(json!({
            "appointment": {
                "status": "booked",
                "slot": call_slot.clone(),
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
    ];

    let mut machine = PlanStateMachine::new(plan_steps.len());
    machine.apply(PlanEvent::SubmittedForPolicy)?;
    machine.apply(PlanEvent::PolicyApproved)?;

    let executors = MockGenericExecutors::new(memory.clone(), subject_id);

    for (step_index, primitive) in plan_steps.iter().enumerate() {
        let step_number = step_index as i32;

        if primitive.kind == ActionPrimitiveKind::Confirm {
            machine.apply(PlanEvent::RequiresHumanConfirmation { step_index })?;

            let confirm_payload = json!({ "decision": "approved" });
            let audit_payload = json!({
                "primitive": primitive,
                "executor": "human",
                "result": confirm_payload.clone(),
            });

            let event = NewPlannerEvent::from_payload(
                Uuid::new_v4(),
                plan_id,
                step_number,
                Utc::now(),
                &audit_payload,
            )?;
            assert!(matches!(
                event_log.append(event).await?,
                AppendOutcome::Inserted(_)
            ));

            memory
                .create_episodic_event(NewEpisodicEvent {
                    subject_id,
                    event_id: Uuid::new_v4(),
                    occurred_at: Utc::now(),
                    channel: "human".into(),
                    event_type: "confirmation.response".into(),
                    payload: confirm_payload,
                })
                .await?;

            machine.apply(PlanEvent::HumanApproved { step_index })?;
            continue;
        }

        machine.apply(PlanEvent::StepDispatched { step_index })?;
        let outcome = executors
            .execute(primitive)
            .await
            .with_context(|| format!("execute step {step_index}"))?;

        if let Some(expected) = primitive.postcondition.as_ref() {
            assert_eq!(expected, &outcome.postcondition, "postcondition mismatch");
        } else {
            bail!("expected postcondition for non-confirm primitive at step {step_index}");
        }

        let audit_payload = json!({
            "primitive": primitive,
            "executor": outcome.executor,
            "result": outcome.postcondition.clone(),
        });

        let event = NewPlannerEvent::from_payload(
            Uuid::new_v4(),
            plan_id,
            step_number,
            Utc::now(),
            &audit_payload,
        )?;
        assert!(matches!(
            event_log.append(event).await?,
            AppendOutcome::Inserted(_)
        ));

        machine.apply(PlanEvent::PostconditionSatisfied { step_index })?;
    }

    let success = match machine.status() {
        PlanStatus::Succeeded(success) => success,
        status => bail!("plan did not succeed: {status:?}"),
    };
    assert_eq!(success.steps_executed, plan_steps.len());

    let events = event_log
        .events_for_plan(plan_id)
        .await
        .context("fetch plan events")?;
    assert_eq!(events.len(), plan_steps.len());

    for (idx, (event, primitive)) in events.iter().zip(plan_steps.iter()).enumerate() {
        assert_eq!(event.step_index as usize, idx);

        let recorded: ActionPrimitive = serde_json::from_value(event.action["primitive"].clone())?;
        assert_eq!(recorded, *primitive);

        match primitive.kind {
            ActionPrimitiveKind::Confirm => {
                assert_eq!(event.action["executor"], "human");
                assert_eq!(event.action["result"]["decision"], "approved");
            }
            _ => {
                let expected = primitive
                    .postcondition
                    .as_ref()
                    .expect("postcondition present");
                assert_eq!(&event.action["result"], expected);
            }
        }
    }

    let facts = memory
        .list_facts_for_subject(subject_id)
        .await
        .context("read facts")?;
    assert_eq!(facts.len(), 1);
    assert_eq!(facts[0].fact_key, "last_scheduled_call");
    assert_eq!(facts[0].fact_value["status"], "booked");

    let episodic = memory
        .list_episodic_events_for_subject(subject_id)
        .await
        .context("read episodic events")?;
    assert_eq!(episodic.len(), 3);

    let event_types: Vec<&str> = episodic
        .iter()
        .map(|event| event.event_type.as_str())
        .collect();
    assert!(event_types.contains(&"executor.web"));
    assert!(event_types.contains(&"message.sent"));
    assert!(event_types.contains(&"confirmation.response"));

    let message_event = episodic
        .iter()
        .find(|event| event.event_type == "message.sent")
        .expect("message event stored");
    assert_eq!(message_event.channel, "email");

    Ok(())
}

struct MockGenericExecutors {
    memory: MemoryDal,
    subject_id: Uuid,
}

impl MockGenericExecutors {
    fn new(memory: MemoryDal, subject_id: Uuid) -> Self {
        Self { memory, subject_id }
    }

    async fn execute(&self, primitive: &ActionPrimitive) -> Result<ExecutorOutcome> {
        match primitive.kind {
            ActionPrimitiveKind::Web => self.handle_web(primitive).await,
            ActionPrimitiveKind::Message => self.handle_message(primitive).await,
            other => bail!("unsupported primitive kind: {other:?}"),
        }
    }

    async fn handle_web(&self, primitive: &ActionPrimitive) -> Result<ExecutorOutcome> {
        let slot = primitive
            .args
            .get("slot")
            .cloned()
            .context("web primitive missing slot")?;

        self.memory
            .create_fact(NewFact {
                subject_id: self.subject_id,
                fact_key: "last_scheduled_call".into(),
                fact_value: json!({
                    "status": "booked",
                    "slot": slot.clone(),
                }),
                source: "integration-test".into(),
                observed_at: Utc::now(),
                confidence: 1.0,
            })
            .await?;

        self.memory
            .create_episodic_event(NewEpisodicEvent {
                subject_id: self.subject_id,
                event_id: Uuid::new_v4(),
                occurred_at: Utc::now(),
                channel: "executor".into(),
                event_type: "executor.web".into(),
                payload: json!({
                    "action": "book_call",
                    "slot": slot.clone(),
                }),
            })
            .await?;

        Ok(ExecutorOutcome {
            executor: "generic-web",
            postcondition: json!({
                "appointment": {
                    "status": "booked",
                    "slot": slot,
                }
            }),
        })
    }

    async fn handle_message(&self, primitive: &ActionPrimitive) -> Result<ExecutorOutcome> {
        let channel = primitive
            .args
            .get("channel")
            .and_then(Value::as_str)
            .context("message primitive missing channel")?;
        let recipient = primitive
            .args
            .get("recipient")
            .and_then(Value::as_str)
            .context("message primitive missing recipient")?;
        let body = primitive
            .args
            .get("body")
            .and_then(Value::as_str)
            .context("message primitive missing body")?;

        self.memory
            .create_episodic_event(NewEpisodicEvent {
                subject_id: self.subject_id,
                event_id: Uuid::new_v4(),
                occurred_at: Utc::now(),
                channel: channel.into(),
                event_type: "message.sent".into(),
                payload: json!({
                    "to": recipient,
                    "body": body,
                }),
            })
            .await?;

        Ok(ExecutorOutcome {
            executor: "generic-message",
            postcondition: json!({
                "status": "delivered",
                "channel": channel,
            }),
        })
    }
}

struct ExecutorOutcome {
    executor: &'static str,
    postcondition: Value,
}

fn into_args(value: Value) -> ActionArguments {
    match value {
        Value::Object(map) => map,
        other => panic!("expected object for action arguments, got {other:?}"),
    }
}
