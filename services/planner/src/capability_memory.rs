use std::time::Instant;

use serde_json::{Map as JsonMap, Value, json};
use tracing::{Span, info_span};
use uuid::Uuid;

use crate::ActionPrimitive;
use crate::event_log::{capability_type_label, derive_capability_identifier};
use tyrum_memory::{CapabilityMemory, MemoryDal, MemoryError};

/// Facade responsible for hydrating action primitives with prior capability memory.
#[derive(Clone)]
pub struct CapabilityMemoryService {
    dal: MemoryDal,
}

impl CapabilityMemoryService {
    #[must_use]
    pub fn new(dal: MemoryDal) -> Self {
        Self { dal }
    }

    /// Attempts to hydrate the provided primitives with previously recorded capability memory.
    pub async fn hydrate_primitives(&self, subject_id: Uuid, steps: &mut [ActionPrimitive]) {
        for primitive in steps.iter_mut() {
            if !primitive.kind.requires_postcondition() {
                continue;
            }

            let Some(executor_kind) = primitive
                .args
                .get("executor")
                .and_then(Value::as_str)
                .map(str::to_string)
            else {
                continue;
            };

            let Some(capability_identifier) = derive_capability_identifier(primitive) else {
                continue;
            };

            let capability_type = capability_type_label(primitive.kind);
            let span = info_span!(
                target: "tyrum::planner",
                "planner.capability_memory.lookup",
                subject_id = %subject_id,
                capability_type,
                capability_identifier = capability_identifier.as_str(),
                executor_kind = executor_kind.as_str(),
                hit = tracing::field::Empty,
                latency_ms = tracing::field::Empty
            );
            let _guard = span.enter();

            let started = Instant::now();
            let lookup = self
                .dal
                .get_capability_memory_for_flow(
                    subject_id,
                    capability_type,
                    capability_identifier.as_str(),
                    executor_kind.as_str(),
                )
                .await;
            let latency = clamp_latency(started.elapsed().as_millis());
            let mut context = LookupContext {
                primitive,
                span: &span,
                subject_id,
                capability_identifier: capability_identifier.as_str(),
                executor_kind: executor_kind.as_str(),
            };
            self.handle_lookup_result(&mut context, lookup, latency);
        }
    }

    fn handle_lookup_result(
        &self,
        context: &mut LookupContext<'_>,
        lookup: Result<Option<CapabilityMemory>, MemoryError>,
        latency_ms: i64,
    ) {
        context.span.record("latency_ms", latency_ms);

        match lookup {
            Ok(Some(memory)) => {
                context.span.record("hit", true);
                Self::apply_memory(context.primitive, &memory);
            }
            Ok(None) => {
                context.span.record("hit", false);
            }
            Err(error) => {
                context.span.record("hit", false);
                tracing::warn!(
                    target: "tyrum::planner",
                    %error,
                    subject_id = %context.subject_id,
                    capability_identifier = context.capability_identifier,
                    executor_kind = context.executor_kind,
                    "failed to load capability memory"
                );
            }
        }
    }

    fn apply_memory(primitive: &mut ActionPrimitive, memory: &CapabilityMemory) {
        if let Some(selectors) = memory.selectors.clone() {
            match primitive.args.get_mut("selector_hints") {
                Some(existing) if existing.is_object() && selectors.is_object() => {
                    if let (Some(existing_map), Some(memory_map)) =
                        (existing.as_object_mut(), selectors.as_object())
                    {
                        for (key, value) in memory_map {
                            existing_map.entry(key.clone()).or_insert(value.clone());
                        }
                    }
                }
                Some(_) => {
                    // Existing selector hints are present but not an object; do not overwrite.
                }
                None => {
                    primitive
                        .args
                        .insert("selector_hints".into(), selectors.clone());
                }
            }
        }

        let mut payload = JsonMap::new();
        payload.insert(
            "capability_type".into(),
            Value::String(memory.capability_type.clone()),
        );
        payload.insert(
            "capability_identifier".into(),
            Value::String(memory.capability_identifier.clone()),
        );
        payload.insert(
            "executor_kind".into(),
            Value::String(memory.executor_kind.clone()),
        );
        payload.insert("success_count".into(), json!(memory.success_count));
        payload.insert("last_success_at".into(), json!(memory.last_success_at));
        payload.insert("outcome_metadata".into(), memory.outcome_metadata.clone());
        payload.insert("cost_profile".into(), memory.cost_profile.clone());
        payload.insert("anti_bot_notes".into(), memory.anti_bot_notes.clone());
        if let Some(summary) = memory.result_summary.as_ref() {
            payload.insert("result_summary".into(), Value::String(summary.clone()));
        }
        if let Some(selectors) = memory.selectors.clone() {
            payload.insert("selectors".into(), selectors);
        }

        primitive
            .args
            .insert("capability_memory".into(), Value::Object(payload));
    }
}

struct LookupContext<'a> {
    primitive: &'a mut ActionPrimitive,
    span: &'a Span,
    subject_id: Uuid,
    capability_identifier: &'a str,
    executor_kind: &'a str,
}

fn clamp_latency(millis: u128) -> i64 {
    i64::try_from(millis).unwrap_or(i64::MAX)
}
