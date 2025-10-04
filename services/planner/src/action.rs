use serde::{Deserialize, Serialize};
use serde_json::{Map as JsonMap, Value};

/// Parameters passed to an [`ActionPrimitive`] invocation.
pub type ActionArguments = JsonMap<String, Value>;

/// Arbitrary predicate describing the evidence we expect after an action.
pub type ActionPostcondition = Value;

/// Neutral action representation exchanged between planner and executors.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActionPrimitive {
    #[serde(rename = "type")]
    pub kind: ActionPrimitiveKind,
    #[serde(default)]
    pub args: ActionArguments,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub postcondition: Option<ActionPostcondition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idempotency_key: Option<String>,
}

impl ActionPrimitive {
    /// Construct a new primitive with the required `type` and `args` fields.
    pub fn new(kind: ActionPrimitiveKind, args: ActionArguments) -> Self {
        Self {
            kind,
            args,
            postcondition: None,
            idempotency_key: None,
        }
    }

    /// Attach an action postcondition, replacing any existing value.
    pub fn with_postcondition(mut self, postcondition: ActionPostcondition) -> Self {
        self.postcondition = Some(postcondition);
        self
    }

    /// Attach an idempotency key used by executors to dedupe retries.
    pub fn with_idempotency_key(mut self, idempotency_key: impl Into<String>) -> Self {
        self.idempotency_key = Some(idempotency_key.into());
        self
    }

    /// Returns `true` if this primitive requires a postcondition for safe execution.
    pub fn requires_postcondition(&self) -> bool {
        self.kind.requires_postcondition()
    }
}

/// Enumerates supported action primitive kinds.
#[allow(clippy::exhaustive_enums)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum ActionPrimitiveKind {
    Research,
    Decide,
    Web,
    Android,
    #[serde(rename = "CLI")]
    Cli,
    Http,
    Message,
    Pay,
    Store,
    Watch,
    Confirm,
}

impl ActionPrimitiveKind {
    /// Returns `true` when the primitive mutates external state and must assert a postcondition.
    pub fn requires_postcondition(self) -> bool {
        matches!(
            self,
            Self::Web
                | Self::Android
                | Self::Cli
                | Self::Http
                | Self::Message
                | Self::Pay
                | Self::Store
                | Self::Watch
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serde_round_trip_respects_schema() {
        let mut args = ActionArguments::default();
        args.insert("query".into(), Value::String("find coffees".into()));
        let primitive = ActionPrimitive::new(ActionPrimitiveKind::Research, args.clone())
            .with_idempotency_key("research-1");
        let json = serde_json::to_value(&primitive).expect("serialize primitive");
        assert_eq!(json["type"], "Research");
        assert_eq!(json["args"], serde_json::Value::Object(args));
        assert!(json.get("postcondition").is_none());
        assert_eq!(json["idempotency_key"], "research-1");

        let restored: ActionPrimitive =
            serde_json::from_value(json).expect("deserialize primitive");
        assert_eq!(restored.kind, ActionPrimitiveKind::Research);
        assert_eq!(restored.args.get("query").unwrap(), "find coffees");
        assert_eq!(restored.idempotency_key.as_deref(), Some("research-1"));
    }

    #[test]
    fn mutating_primitives_require_postconditions() {
        for kind in [
            ActionPrimitiveKind::Web,
            ActionPrimitiveKind::Android,
            ActionPrimitiveKind::Cli,
            ActionPrimitiveKind::Http,
            ActionPrimitiveKind::Message,
            ActionPrimitiveKind::Pay,
            ActionPrimitiveKind::Store,
            ActionPrimitiveKind::Watch,
        ] {
            assert!(
                kind.requires_postcondition(),
                "{kind:?} should require postcondition"
            );
        }

        for kind in [
            ActionPrimitiveKind::Research,
            ActionPrimitiveKind::Decide,
            ActionPrimitiveKind::Confirm,
        ] {
            assert!(
                !kind.requires_postcondition(),
                "{kind:?} should not require postcondition"
            );
        }
    }
}
