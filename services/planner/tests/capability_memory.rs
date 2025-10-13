#![allow(clippy::expect_used, clippy::unwrap_used)]

mod common;

use anyhow::{Context, Result, bail};
use chrono::{DateTime, Utc};
use common::postgres::{TestPostgres, docker_available};
use serde_json::{Map as JsonMap, Value, json};
use std::convert::TryFrom;
use tracing::Subscriber;
use tracing::field::{Field, Visit};
use tracing_subscriber::{
    Layer,
    layer::{Context as LayerContext, SubscriberExt},
    registry::LookupSpan,
};
use tyrum_memory::{MemoryDal, NewCapabilityMemory, NewEpisodicEvent, NewFact};
use tyrum_planner::{
    ActionArguments, ActionPrimitive, ActionPrimitiveKind, AppendOutcome, CapabilityMemoryResult,
    CapabilityMemoryService, EventLog, NewPlannerEvent, PlanEvent, PlanStateMachine, PlanStatus,
};
use uuid::Uuid;

#[tokio::test(flavor = "multi_thread")]
async fn mock_book_call_plan_creates_audit_and_memory_artifacts() -> Result<()> {
    if !docker_available() {
        eprintln!(
            "skipping mock_book_call_plan_creates_audit_and_memory_artifacts: docker unavailable"
        );
        return Ok(());
    }
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
                "selector_hints": {
                    "login_button": "#login",
                    "email_input": {
                        "selector": "input[type=\"email\"]",
                        "prefill": "alex@example.com"
                    },
                    "otp_field": {
                        "selector": "[data-test=\"otp\"]",
                        "value": "123456"
                    }
                }
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
        let step_number = i32::try_from(step_index).context("plan step index overflow")?;

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

        let occurred_at = Utc::now();
        let audit_payload = json!({
            "primitive": primitive,
            "executor": outcome.executor,
            "result": outcome.postcondition.clone(),
        });

        let event = NewPlannerEvent::from_payload(
            Uuid::new_v4(),
            plan_id,
            step_number,
            occurred_at,
            &audit_payload,
        )?;
        assert!(matches!(
            event_log.append(event).await?,
            AppendOutcome::Inserted(_)
        ));

        machine.apply(PlanEvent::PostconditionSatisfied { step_index })?;

        let capability_payload = outcome.capability_payload();
        let memory_outcome = event_log
            .record_capability_memory(
                subject_id,
                primitive,
                outcome.executor,
                &capability_payload,
                occurred_at,
            )
            .await?;

        if primitive.kind == ActionPrimitiveKind::Web {
            assert!(matches!(
                memory_outcome,
                CapabilityMemoryResult::Inserted { success_count: 1 }
            ));
        } else {
            assert!(matches!(memory_outcome, CapabilityMemoryResult::Skipped(_)));
        }
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
        let recorded_index = usize::try_from(event.step_index).expect("event step is non-negative");
        assert_eq!(recorded_index, idx);

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

    let capability_memories = memory
        .list_capability_memories_for_subject(subject_id)
        .await
        .context("read capability memories")?;
    assert_eq!(capability_memories.len(), 1);

    let capability = &capability_memories[0];
    assert_eq!(capability.capability_type, "web");
    assert_eq!(capability.capability_identifier, "calendar.example.com");
    assert_eq!(capability.executor_kind, "generic-web");
    assert_eq!(capability.success_count, 1);
    assert_eq!(
        capability.result_summary.as_deref(),
        Some("generic-web satisfied intent book_call")
    );

    let selectors = capability.selectors.as_ref().expect("selectors captured");
    assert_eq!(selectors["login_button"], "#login");
    assert_eq!(
        selectors["email_input"]["prefill"],
        Value::String("[redacted]".into())
    );
    assert_eq!(selectors["otp_field"], Value::String("[redacted]".into()));

    assert_eq!(
        capability.outcome_metadata["postcondition"]["appointment"]["status"],
        "booked"
    );
    assert_eq!(capability.cost_profile["currency"], "USD");
    assert_eq!(capability.cost_profile["amount_minor_units"], 1500);
    let anti_bot_notes = capability
        .anti_bot_notes
        .as_array()
        .expect("anti_bot notes stored as array");
    assert!(
        !anti_bot_notes.is_empty(),
        "anti-bot notes should be populated"
    );
    assert_eq!(anti_bot_notes[0]["issue"], "captcha_after_login");

    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn capability_memory_hydration_hit_populates_primitive() -> Result<()> {
    if !docker_available() {
        eprintln!(
            "skipping capability_memory_hydration_hit_populates_primitive: docker unavailable"
        );
        return Ok(());
    }

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
    let last_success_at = Utc::now();

    memory
        .create_capability_memory(NewCapabilityMemory {
            subject_id,
            capability_type: "web".into(),
            capability_identifier: "calendar.example.com".into(),
            executor_kind: "generic-web".into(),
            selectors: Some(json!({
                "login_button": "#login",
                "email_input": { "selector": "input[type=\"email\"]", "prefill": "alex@example.com" },
                "otp_field": "[data-test=\"otp\"]"
            })),
            outcome_metadata: json!({
                "postcondition": {
                    "appointment": {
                        "status": "booked"
                    }
                },
                "voice_rationale": "fallback automation"
            }),
            cost_profile: json!({
                "currency": "USD",
                "amount_minor_units": 4500,
                "observed_at": Utc::now()
            }),
            anti_bot_notes: json!([
                {
                    "issue": "ip_rate_limit",
                    "mitigation": "rotate_proxy_pool",
                    "last_seen": Utc::now()
                }
            ]),
            result_summary: Some("generic-web satisfied intent book_call".into()),
            success_count: 3,
            last_success_at,
        })
        .await
        .context("seed capability memory")?;

    let primitive = ActionPrimitive::new(
        ActionPrimitiveKind::Web,
        into_args(json!({
            "executor": "generic-web",
            "intent": "fallback_automation",
            "capability_identifier": "calendar.example.com"
        })),
    )
    .with_postcondition(json!({
        "status": "completed"
    }));

    let mut steps = vec![primitive];
    let recorder = LookupRecorder::default();
    let subscriber = tracing_subscriber::registry().with(recorder.clone());
    let service = CapabilityMemoryService::new(memory.clone());

    let _guard = tracing::subscriber::set_default(subscriber);
    service.hydrate_primitives(subject_id, &mut steps).await;

    let enriched = &steps[0];
    let capability = enriched
        .args
        .get("capability_memory")
        .and_then(Value::as_object)
        .expect("capability memory attached");
    assert_eq!(
        capability
            .get("capability_identifier")
            .and_then(Value::as_str),
        Some("calendar.example.com")
    );
    assert_eq!(
        capability.get("executor_kind").and_then(Value::as_str),
        Some("generic-web")
    );
    assert_eq!(
        capability.get("success_count").and_then(Value::as_i64),
        Some(3)
    );
    let last_success_value = capability
        .get("last_success_at")
        .and_then(Value::as_str)
        .expect("last_success_at present");
    let parsed_last_success = DateTime::parse_from_rfc3339(last_success_value)
        .expect("parse last_success_at")
        .with_timezone(&Utc);
    let delta = parsed_last_success
        .signed_duration_since(last_success_at)
        .num_nanoseconds()
        .unwrap_or_default()
        .abs();
    assert!(
        delta <= 1_000,
        "last_success_at drift exceeded tolerance: {delta}ns"
    );
    assert_eq!(
        capability.get("result_summary").and_then(Value::as_str),
        Some("generic-web satisfied intent book_call")
    );
    let outcome_metadata = capability
        .get("outcome_metadata")
        .and_then(Value::as_object)
        .expect("outcome_metadata populated");
    assert_eq!(
        outcome_metadata.get("postcondition"),
        Some(&json!({
            "appointment": {
                "status": "booked"
            }
        }))
    );
    assert_eq!(
        outcome_metadata
            .get("voice_rationale")
            .and_then(Value::as_str),
        Some("fallback automation")
    );
    let cost_profile = capability
        .get("cost_profile")
        .and_then(Value::as_object)
        .expect("cost profile attached");
    assert_eq!(cost_profile.get("currency"), Some(&json!("USD")));
    let anti_bot_notes = capability
        .get("anti_bot_notes")
        .and_then(Value::as_array)
        .expect("anti-bot notes attached");
    assert!(!anti_bot_notes.is_empty());
    let selector_hints = enriched
        .args
        .get("selector_hints")
        .and_then(Value::as_object)
        .expect("selector hints populated");
    assert_eq!(selector_hints.get("login_button"), Some(&json!("#login")));
    assert_eq!(
        selector_hints.get("otp_field"),
        Some(&json!("[data-test=\"otp\"]"))
    );

    let records = recorder.records();
    assert_eq!(records.len(), 1);
    let lookup = &records[0];
    let expected_subject = subject_id.to_string();
    assert_eq!(
        lookup.subject_id.as_deref(),
        Some(expected_subject.as_str())
    );
    assert_eq!(
        lookup.capability_identifier.as_deref(),
        Some("calendar.example.com")
    );
    assert_eq!(lookup.executor_kind.as_deref(), Some("generic-web"));
    assert_eq!(lookup.capability_type.as_deref(), Some("web"));
    assert_eq!(lookup.hit, Some(true));
    assert!(lookup.latency_ms.is_some());

    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn capability_memory_hydration_miss_logs_lookup() -> Result<()> {
    if !docker_available() {
        eprintln!("skipping capability_memory_hydration_miss_logs_lookup: docker unavailable");
        return Ok(());
    }

    let postgres = TestPostgres::start()
        .await
        .context("start postgres fixture")?;
    let pool = postgres.pool().clone();
    let event_log = EventLog::from_pool(pool.clone());
    event_log
        .migrate()
        .await
        .context("migrate planner schema")?;
    let memory = MemoryDal::new(pool);
    let service = CapabilityMemoryService::new(memory.clone());

    let subject_id = Uuid::new_v4();
    let primitive = ActionPrimitive::new(
        ActionPrimitiveKind::Web,
        into_args(json!({
            "executor": "generic-web",
            "intent": "fallback_automation",
            "capability_identifier": "calendar.example.com"
        })),
    )
    .with_postcondition(json!({
        "status": "completed"
    }));
    let mut steps = vec![primitive];

    let recorder = LookupRecorder::default();
    let subscriber = tracing_subscriber::registry().with(recorder.clone());

    let _guard = tracing::subscriber::set_default(subscriber);
    service.hydrate_primitives(subject_id, &mut steps).await;

    let enriched = &steps[0];
    assert!(
        enriched.args.get("capability_memory").is_none(),
        "capability memory should not be attached on cache miss"
    );
    assert!(
        enriched.args.get("selector_hints").is_none(),
        "selector hints should remain absent on miss"
    );

    let records = recorder.records();
    assert_eq!(records.len(), 1);
    let lookup = &records[0];
    assert_eq!(lookup.hit, Some(false));
    assert!(lookup.latency_ms.is_some());

    Ok(())
}

#[derive(Clone, Debug, Default)]
struct LookupRecorder {
    records: std::sync::Arc<std::sync::Mutex<Vec<LookupRecord>>>,
}

#[derive(Clone, Debug, Default)]
struct LookupRecord {
    subject_id: Option<String>,
    capability_identifier: Option<String>,
    executor_kind: Option<String>,
    capability_type: Option<String>,
    hit: Option<bool>,
    latency_ms: Option<i64>,
}

impl LookupRecorder {
    fn records(&self) -> Vec<LookupRecord> {
        self.records.lock().expect("read lookup records").clone()
    }
}

impl<S> Layer<S> for LookupRecorder
where
    S: Subscriber + for<'a> LookupSpan<'a>,
{
    fn on_new_span(
        &self,
        attrs: &tracing::span::Attributes<'_>,
        id: &tracing::span::Id,
        ctx: LayerContext<'_, S>,
    ) {
        if attrs.metadata().name() != "planner.capability_memory.lookup" {
            return;
        }

        let mut record = LookupRecord::default();
        attrs.record(&mut LookupVisitor {
            record: &mut record,
        });

        if let Some(span) = ctx.span(id) {
            span.extensions_mut().insert(record);
        }
    }

    fn on_record(
        &self,
        id: &tracing::span::Id,
        values: &tracing::span::Record<'_>,
        ctx: LayerContext<'_, S>,
    ) {
        if let Some(span) = ctx.span(id)
            && let Some(record) = span.extensions_mut().get_mut::<LookupRecord>()
        {
            values.record(&mut LookupVisitor { record });
        }
    }

    fn on_close(&self, id: tracing::span::Id, ctx: LayerContext<'_, S>) {
        if let Some(span) = ctx.span(&id)
            && let Some(record) = span.extensions_mut().remove::<LookupRecord>()
        {
            self.records
                .lock()
                .expect("store lookup record")
                .push(record);
        }
    }
}

struct LookupVisitor<'a> {
    record: &'a mut LookupRecord,
}

impl<'a> Visit for LookupVisitor<'a> {
    fn record_str(&mut self, field: &Field, value: &str) {
        match field.name() {
            "subject_id" => self.record.subject_id = Some(value.to_string()),
            "capability_identifier" => self.record.capability_identifier = Some(value.to_string()),
            "executor_kind" => self.record.executor_kind = Some(value.to_string()),
            "capability_type" => self.record.capability_type = Some(value.to_string()),
            _ => {}
        }
    }

    fn record_bool(&mut self, field: &Field, value: bool) {
        if field.name() == "hit" {
            self.record.hit = Some(value);
        }
    }

    fn record_i64(&mut self, field: &Field, value: i64) {
        if field.name() == "latency_ms" {
            self.record.latency_ms = Some(value);
        }
    }

    fn record_u64(&mut self, field: &Field, value: u64) {
        if field.name() == "latency_ms" {
            let clamped = i64::try_from(value).unwrap_or(i64::MAX);
            self.record.latency_ms = Some(clamped);
        }
    }

    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        let rendered = format!("{value:?}");
        match field.name() {
            "subject_id" => {
                if self.record.subject_id.is_none() {
                    self.record.subject_id = Some(rendered.trim_matches('"').to_string());
                }
            }
            "capability_identifier" => {
                if self.record.capability_identifier.is_none() {
                    self.record.capability_identifier =
                        Some(rendered.trim_matches('"').to_string());
                }
            }
            "executor_kind" => {
                if self.record.executor_kind.is_none() {
                    self.record.executor_kind = Some(rendered.trim_matches('"').to_string());
                }
            }
            "capability_type" => {
                if self.record.capability_type.is_none() {
                    self.record.capability_type = Some(rendered.trim_matches('"').to_string());
                }
            }
            "hit" => {
                if self.record.hit.is_none()
                    && let Ok(parsed) = rendered.parse::<bool>()
                {
                    self.record.hit = Some(parsed);
                }
            }
            "latency_ms" => {
                if self.record.latency_ms.is_none()
                    && let Ok(parsed) = rendered.parse::<i64>()
                {
                    self.record.latency_ms = Some(parsed);
                }
            }
            _ => {}
        }
    }
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
            cost_profile: Some(json!({
                "currency": "USD",
                "amount_minor_units": 1500,
                "observed_at": Utc::now(),
                "vendor": "calendar.example.com"
            })),
            anti_bot_notes: Some(json!([
                {
                    "issue": "captcha_after_login",
                    "mitigation": "wait_3s_then_retry",
                    "last_seen": Utc::now()
                }
            ])),
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
            cost_profile: None,
            anti_bot_notes: None,
        })
    }
}

struct ExecutorOutcome {
    executor: &'static str,
    postcondition: Value,
    cost_profile: Option<Value>,
    anti_bot_notes: Option<Value>,
}

impl ExecutorOutcome {
    fn capability_payload(&self) -> Value {
        let mut payload = JsonMap::new();
        payload.insert("postcondition".into(), self.postcondition.clone());
        if let Some(cost_profile) = &self.cost_profile {
            payload.insert("cost_profile".into(), cost_profile.clone());
        }
        if let Some(anti_bot_notes) = &self.anti_bot_notes {
            payload.insert("anti_bot_notes".into(), anti_bot_notes.clone());
        }
        Value::Object(payload)
    }
}

fn into_args(value: Value) -> ActionArguments {
    match value {
        Value::Object(map) => map,
        other => panic!("expected object for action arguments, got {other:?}"),
    }
}
