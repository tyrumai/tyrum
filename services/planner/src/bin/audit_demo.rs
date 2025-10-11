use std::{convert::TryFrom, fs, path::PathBuf, time::Duration};

use anyhow::{Context, Result, bail, ensure};
use chrono::Utc;
use serde::Serialize;
use serde_json::{Value, json};
use sqlx::{PgPool, postgres::PgPoolOptions};
use testcontainers::{
    ContainerAsync, GenericImage, ImageExt,
    core::{IntoContainerPort, WaitFor},
    runners::AsyncRunner,
};
use tokio::time::sleep;
use tracing::info;
use tracing_subscriber::EnvFilter;
use uuid::Uuid;

use tyrum_memory::{MemoryDal, NewEpisodicEvent, NewFact};
use tyrum_planner::{
    ActionArguments, ActionPrimitive, ActionPrimitiveKind, AppendOutcome, EventLog,
    NewPlannerEvent, PlanEvent, PlanStateMachine, PlanStatus,
};

const POSTGRES_IMAGE: &str = "pgvector/pgvector";
const POSTGRES_TAG: &str = "pg16";
const POSTGRES_USER: &str = "tyrum";
const POSTGRES_PASSWORD: &str = "tyrum_dev_password";
const POSTGRES_DB: &str = "tyrum_dev";

#[tokio::main(flavor = "multi_thread")]
async fn main() -> Result<()> {
    init_tracing();
    let mut runtime = DemoRuntime::start().await?;
    let artifact = runtime.execute().await?;
    drop(runtime);

    let paths = write_artifacts(&artifact)?;
    let json_path = paths.json.display().to_string();
    let markdown_path = paths.markdown.display().to_string();

    info!(
        json = json_path.as_str(),
        markdown = markdown_path.as_str(),
        "audit demo completed"
    );

    println!(
        "\nAudit demo complete. Trace written to:\n  - {}\n  - {}\n",
        json_path, markdown_path
    );

    Ok(())
}

fn init_tracing() {
    let default_level = "audit_demo=info,tyrum_planner=info";
    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(default_level));

    let subscriber = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .compact()
        .finish();

    let _ = tracing::subscriber::set_global_default(subscriber);
}

struct DemoRuntime {
    _container: ContainerAsync<GenericImage>,
    event_log: EventLog,
    memory: MemoryDal,
}

impl DemoRuntime {
    async fn start() -> Result<Self> {
        let image = GenericImage::new(POSTGRES_IMAGE, POSTGRES_TAG)
            .with_exposed_port(5432.tcp())
            .with_wait_for(WaitFor::message_on_stdout(
                "database system is ready to accept connections",
            ));

        let request = image
            .with_env_var("POSTGRES_USER", POSTGRES_USER)
            .with_env_var("POSTGRES_PASSWORD", POSTGRES_PASSWORD)
            .with_env_var("POSTGRES_DB", POSTGRES_DB);

        let container = request
            .start()
            .await
            .context("start postgres container for audit demo")?;
        let host_port = container
            .get_host_port_ipv4(5432.tcp())
            .await
            .context("map postgres port")?;

        let database_url = format!(
            "postgres://{}:{}@127.0.0.1:{}/{}",
            POSTGRES_USER, POSTGRES_PASSWORD, host_port, POSTGRES_DB
        );

        let pool = connect_with_retry(&database_url).await?;
        let event_log = EventLog::from_pool(pool.clone());
        event_log
            .migrate()
            .await
            .context("run planner + memory migrations")?;
        let memory = MemoryDal::new(pool);

        Ok(Self {
            _container: container,
            event_log,
            memory,
        })
    }

    async fn execute(&mut self) -> Result<TraceArtifact> {
        let subject_id = Uuid::new_v4();
        let plan_id = Uuid::new_v4();
        let call_slot = json!({
            "start": "2025-10-18T15:00:00Z",
            "end": "2025-10-18T15:30:00Z",
            "with": "Alex Doe",
        });

        let plan_steps = build_plan(call_slot.clone());
        let mut machine = PlanStateMachine::new(plan_steps.len());
        machine.apply(PlanEvent::SubmittedForPolicy)?;
        machine.apply(PlanEvent::PolicyApproved)?;

        let executors = MockGenericExecutors::new(self.memory.clone(), subject_id);

        for (step_index, primitive) in plan_steps.iter().enumerate() {
            if primitive.kind == ActionPrimitiveKind::Confirm {
                self.handle_confirm_step(&mut machine, plan_id, subject_id, step_index, primitive)
                    .await?;
            } else {
                self.handle_executor_step(
                    &mut machine,
                    plan_id,
                    subject_id,
                    step_index,
                    primitive,
                    &executors,
                )
                .await?;
            }
        }

        let success = match machine.status() {
            PlanStatus::Succeeded(success) => success,
            status => bail!("plan did not succeed: {status:?}"),
        };
        ensure!(
            success.steps_executed == plan_steps.len(),
            "expected {} steps executed",
            plan_steps.len()
        );

        self.collect_trace(plan_id, subject_id, &plan_steps).await
    }

    async fn handle_confirm_step(
        &self,
        machine: &mut PlanStateMachine,
        plan_id: Uuid,
        subject_id: Uuid,
        step_index: usize,
        primitive: &ActionPrimitive,
    ) -> Result<()> {
        let step_number = i32::try_from(step_index).context("plan step index overflow")?;
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

        let outcome = self.event_log.append(event).await?;
        ensure!(
            matches!(outcome, AppendOutcome::Inserted(_)),
            "confirm step should insert audit event"
        );

        self.memory
            .create_episodic_event(NewEpisodicEvent {
                subject_id,
                event_id: Uuid::new_v4(),
                occurred_at: Utc::now(),
                channel: "human".into(),
                event_type: "confirmation.response".into(),
                payload: confirm_payload,
            })
            .await
            .context("store confirmation episodic event")?;

        machine.apply(PlanEvent::HumanApproved { step_index })?;
        Ok(())
    }

    async fn handle_executor_step(
        &self,
        machine: &mut PlanStateMachine,
        plan_id: Uuid,
        subject_id: Uuid,
        step_index: usize,
        primitive: &ActionPrimitive,
        executors: &MockGenericExecutors,
    ) -> Result<()> {
        let step_number = i32::try_from(step_index).context("plan step index overflow")?;
        machine.apply(PlanEvent::StepDispatched { step_index })?;

        let executor_outcome = executors
            .execute(primitive)
            .await
            .with_context(|| format!("execute plan step {step_index}"))?;

        if let Some(expected) = primitive.postcondition.as_ref() {
            ensure!(
                expected == &executor_outcome.postcondition,
                "postcondition mismatch at step {step_index}"
            );
        } else {
            bail!("expected postcondition for non-confirm primitive {step_index}");
        }

        let audit_payload = json!({
            "primitive": primitive,
            "executor": executor_outcome.executor.as_str(),
            "result": executor_outcome.postcondition.clone(),
        });

        let occurred_at = Utc::now();
        let event = NewPlannerEvent::from_payload(
            Uuid::new_v4(),
            plan_id,
            step_number,
            occurred_at,
            &audit_payload,
        )?;
        let append_outcome = self.event_log.append(event).await?;
        ensure!(
            matches!(append_outcome, AppendOutcome::Inserted(_)),
            "executor step should append audit event"
        );

        machine.apply(PlanEvent::PostconditionSatisfied { step_index })?;

        let _ = self
            .event_log
            .record_capability_memory(
                subject_id,
                primitive,
                executor_outcome.executor.as_str(),
                &executor_outcome.postcondition,
                occurred_at,
            )
            .await
            .context("record capability memory")?;
        Ok(())
    }

    async fn collect_trace(
        &self,
        plan_id: Uuid,
        subject_id: Uuid,
        plan_steps: &[ActionPrimitive],
    ) -> Result<TraceArtifact> {
        let events = self
            .event_log
            .events_for_plan(plan_id)
            .await
            .context("fetch plan events for replay")?;
        ensure!(
            events.len() == plan_steps.len(),
            "expected {} events, got {}",
            plan_steps.len(),
            events.len()
        );

        let mut steps = Vec::with_capacity(events.len());
        for (index, event) in events.iter().enumerate() {
            let event_index = usize::try_from(event.step_index)
                .context("event step index must be non-negative")?;
            ensure!(
                event_index == index,
                "event step index mismatch: {} vs {index}",
                event.step_index
            );

            let primitive = event
                .action
                .get("primitive")
                .cloned()
                .context("event missing primitive payload")?;
            let primitive: ActionPrimitive =
                serde_json::from_value(primitive).context("decode primitive from stored event")?;
            ensure!(
                primitive == plan_steps[index],
                "recorded primitive mismatch at step {index}"
            );

            let executor = event
                .action
                .get("executor")
                .and_then(Value::as_str)
                .context("event missing executor field")?
                .to_string();
            let result = event
                .action
                .get("result")
                .cloned()
                .context("event missing result payload")?;

            steps.push(TraceStep {
                step_index: event.step_index,
                occurred_at: event.occurred_at.to_rfc3339(),
                recorded_at: event.created_at.to_rfc3339(),
                primitive,
                executor,
                result,
            });
        }

        let facts = self
            .memory
            .list_facts_for_subject(subject_id)
            .await
            .context("fetch facts for demo subject")?;
        ensure!(facts.len() == 1, "expected single fact recorded");

        let fact_summaries = facts
            .into_iter()
            .map(|fact| FactSummary {
                fact_key: fact.fact_key,
                observed_at: fact.observed_at.to_rfc3339(),
                source: fact.source,
                value: fact.fact_value,
            })
            .collect();

        let episodic = self
            .memory
            .list_episodic_events_for_subject(subject_id)
            .await
            .context("fetch episodic events for demo subject")?;
        ensure!(
            episodic.len() == 3,
            "expected three episodic events recorded"
        );

        let episodic_summaries = episodic
            .into_iter()
            .map(|event| EpisodicSummary {
                event_type: event.event_type,
                occurred_at: event.occurred_at.to_rfc3339(),
                channel: event.channel,
                payload: event.payload,
            })
            .collect();

        Ok(TraceArtifact {
            generated_at: Utc::now().to_rfc3339(),
            plan_id,
            subject_id,
            steps,
            facts: fact_summaries,
            episodic_events: episodic_summaries,
        })
    }
}

async fn connect_with_retry(database_url: &str) -> Result<PgPool> {
    let mut attempts = 0;
    let max_attempts = 10;

    loop {
        match PgPoolOptions::new()
            .max_connections(5)
            .acquire_timeout(Duration::from_secs(5))
            .connect(database_url)
            .await
        {
            Ok(pool) => break Ok(pool),
            Err(err) if attempts < max_attempts => {
                attempts += 1;
                tracing::warn!(
                    attempts,
                    "waiting for postgres to accept connections: {err}"
                );
                sleep(Duration::from_millis(200)).await;
            }
            Err(err) => break Err(err.into()),
        }
    }
}

fn build_plan(call_slot: Value) -> Vec<ActionPrimitive> {
    vec![
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
            "assertions": [
                { "type": "dom_contains", "text": "booked", "case_insensitive": true }
            ],
            "metadata": {
                "appointment": {
                    "status": "booked",
                    "slot": call_slot.clone(),
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
                source: "audit-demo".into(),
                observed_at: Utc::now(),
                confidence: 1.0,
            })
            .await
            .context("store fact for booked call")?;

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
            .await
            .context("store web executor event")?;

        Ok(ExecutorOutcome {
            executor: "generic-web".into(),
            postcondition: json!({
                "assertions": [
                    { "type": "dom_contains", "text": "booked", "case_insensitive": true }
                ],
                "metadata": {
                    "appointment": {
                        "status": "booked",
                        "slot": slot,
                    }
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
            .await
            .context("store message event")?;

        Ok(ExecutorOutcome {
            executor: "generic-message".into(),
            postcondition: json!({
                "status": "delivered",
                "channel": channel,
            }),
        })
    }
}

struct ExecutorOutcome {
    executor: String,
    postcondition: Value,
}

fn into_args(value: Value) -> ActionArguments {
    match value {
        Value::Object(map) => map,
        other => panic!("expected object for action arguments, got {other:?}"),
    }
}

#[derive(Serialize)]
struct TraceArtifact {
    generated_at: String,
    plan_id: Uuid,
    subject_id: Uuid,
    steps: Vec<TraceStep>,
    facts: Vec<FactSummary>,
    episodic_events: Vec<EpisodicSummary>,
}

#[derive(Serialize)]
struct TraceStep {
    step_index: i32,
    occurred_at: String,
    recorded_at: String,
    primitive: ActionPrimitive,
    executor: String,
    result: Value,
}

#[derive(Serialize)]
struct FactSummary {
    fact_key: String,
    observed_at: String,
    source: String,
    value: Value,
}

#[derive(Serialize)]
struct EpisodicSummary {
    event_type: String,
    occurred_at: String,
    channel: String,
    payload: Value,
}

struct ArtifactPaths {
    json: PathBuf,
    markdown: PathBuf,
}

fn write_artifacts(artifact: &TraceArtifact) -> Result<ArtifactPaths> {
    let dir = PathBuf::from("artifacts/audit-demo");
    fs::create_dir_all(&dir).context("create audit demo artifact directory")?;

    let json_path = dir.join("trace.json");
    let json = serde_json::to_vec_pretty(artifact).context("serialize audit demo trace to json")?;
    fs::write(&json_path, json).context("write audit demo json artifact")?;

    let markdown_path = dir.join("trace.md");
    let markdown = render_markdown(artifact);
    fs::write(&markdown_path, markdown).context("write audit demo markdown artifact")?;

    Ok(ArtifactPaths {
        json: json_path,
        markdown: markdown_path,
    })
}

fn render_markdown(artifact: &TraceArtifact) -> String {
    let mut lines = Vec::new();
    lines.push("# Audit Demo Trace".to_string());
    lines.push(String::new());
    lines.push(format!("Generated at: {}", artifact.generated_at));
    lines.push(format!("Plan ID: `{}`", artifact.plan_id));
    lines.push(format!("Subject ID: `{}`", artifact.subject_id));
    lines.push(String::new());
    lines.push("## Planner Steps".to_string());
    lines.push("| Step | Type | Executor | Result | Occurred |".to_string());
    lines.push("| --- | --- | --- | --- | --- |".to_string());

    for step in &artifact.steps {
        let primitive_kind = format!("{:?}", step.primitive.kind);
        let result = truncate_json(&step.result);

        lines.push(format!(
            "| {} | {} | {} | `{}` | {} |",
            step.step_index, primitive_kind, step.executor, result, step.occurred_at
        ));
    }

    lines.push(String::new());
    lines.push("## Facts".to_string());
    lines.push("| Key | Value | Source | Observed |".to_string());
    lines.push("| --- | --- | --- | --- |".to_string());

    for fact in &artifact.facts {
        let value = truncate_json(&fact.value);
        lines.push(format!(
            "| {} | `{}` | {} | {} |",
            fact.fact_key, value, fact.source, fact.observed_at
        ));
    }

    lines.push(String::new());
    lines.push("## Episodic Events".to_string());
    lines.push("| Type | Channel | Payload | Occurred |".to_string());
    lines.push("| --- | --- | --- | --- |".to_string());

    for event in &artifact.episodic_events {
        let payload = truncate_json(&event.payload);
        lines.push(format!(
            "| {} | {} | `{}` | {} |",
            event.event_type, event.channel, payload, event.occurred_at
        ));
    }

    lines.push(String::new());
    lines.join("\n")
}

fn truncate_json(value: &Value) -> String {
    let raw = serde_json::to_string(value).unwrap_or_else(|_| "<unserializable>".into());
    if raw.len() <= 80 {
        raw
    } else {
        let mut truncated = raw.chars().take(77).collect::<String>();
        truncated.push_str("...");
        truncated
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_json_short_values_pass_through() {
        let value = json!({ "status": "ok" });
        assert_eq!(truncate_json(&value), "{\"status\":\"ok\"}");
    }

    #[test]
    fn truncate_json_limits_length() {
        let value = json!({ "notes": "a".repeat(200) });
        let truncated = truncate_json(&value);
        assert_eq!(truncated.len(), 80);
        assert!(truncated.ends_with("..."));
    }

    #[test]
    fn render_markdown_includes_sections() {
        let artifact = TraceArtifact {
            generated_at: "2025-10-03T00:00:00Z".into(),
            plan_id: Uuid::nil(),
            subject_id: Uuid::nil(),
            steps: vec![TraceStep {
                step_index: 0,
                occurred_at: "2025-10-03T00:00:00Z".into(),
                recorded_at: "2025-10-03T00:00:00Z".into(),
                primitive: ActionPrimitive::new(
                    ActionPrimitiveKind::Confirm,
                    into_args(json!({ "prompt": "ok" })),
                ),
                executor: "human".into(),
                result: json!({ "decision": "approved" }),
            }],
            facts: vec![FactSummary {
                fact_key: "demo".into(),
                observed_at: "2025-10-03T00:00:00Z".into(),
                source: "audit-demo".into(),
                value: json!({ "status": "booked" }),
            }],
            episodic_events: vec![EpisodicSummary {
                event_type: "confirmation.response".into(),
                occurred_at: "2025-10-03T00:00:00Z".into(),
                channel: "human".into(),
                payload: json!({ "decision": "approved" }),
            }],
        };

        let markdown = render_markdown(&artifact);
        assert!(markdown.contains("## Planner Steps"));
        assert!(markdown.contains("## Facts"));
        assert!(markdown.contains("## Episodic Events"));
    }
}
