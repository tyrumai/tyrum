use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use thiserror::Error;

const REDACTED: &str = "[REDACTED]";

/// Aggregated evaluation context supplied by executors or planners.
#[derive(Debug, Default, Clone)]
pub struct EvaluationContext<'a> {
    /// HTTP-level evidence (status, etc).
    pub http: Option<HttpContext>,
    /// JSON payload produced by the executor (HTTP response body, etc).
    pub json: Option<&'a Value>,
    /// DOM excerpt captured by a web executor.
    pub dom: Option<DomContext<'a>>,
}

/// Minimal HTTP evidence required for status assertions.
#[derive(Debug, Clone, Copy)]
pub struct HttpContext {
    pub status: u16,
}

/// DOM snapshot evidence supplied by web executors.
#[derive(Debug, Clone)]
pub struct DomContext<'a> {
    pub selector: Option<&'a str>,
    pub html: &'a str,
}

/// Normalised assertion identifiers returned alongside outcomes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssertionKind {
    HttpStatus,
    DomContains,
    JsonPathEquals,
}

/// Deterministic failure codes for postcondition assertions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssertionFailureCode {
    HttpStatusMismatch,
    DomTextMissing,
    JsonPathMissing,
    JsonPathPredicateFailed,
}

/// Result of a single assertion evaluation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AssertionResult {
    pub kind: AssertionKind,
    #[serde(flatten)]
    pub outcome: AssertionOutcome,
}

/// Structured success/failure payload for an assertion.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum AssertionOutcome {
    Passed {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        detail: Option<Value>,
    },
    Failed {
        code: AssertionFailureCode,
        message: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        expected: Option<Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        observed: Option<Value>,
    },
}

/// Aggregated postcondition report spanning every evaluated assertion.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PostconditionReport {
    pub passed: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub assertions: Vec<AssertionResult>,
}

/// Errors surfaced when parsing or evaluating postconditions.
#[derive(Debug, Error)]
pub enum PostconditionError {
    /// Postcondition payload could not be parsed.
    #[error("invalid_postcondition")]
    Invalid { message: String },
    /// Postcondition type is not yet supported by the shared library.
    #[error("unsupported_postcondition")]
    Unsupported { type_name: String },
    /// Required execution evidence is missing (e.g., DOM excerpt not supplied).
    #[error("missing_evidence")]
    MissingEvidence { kind: AssertionKind },
}

/// Evaluate a postcondition payload against the supplied evidence.
pub fn evaluate_postcondition<'a>(
    raw: &Value,
    context: &EvaluationContext<'a>,
) -> Result<PostconditionReport, PostconditionError> {
    let assertions = parse_spec(raw)?;
    let mut results = Vec::with_capacity(assertions.len());
    let mut overall_passed = true;

    for assertion in assertions {
        let (kind, outcome) = evaluate_assertion(&assertion, context)?;
        if !matches!(outcome, AssertionOutcome::Passed { .. }) {
            overall_passed = false;
        }
        results.push(AssertionResult { kind, outcome });
    }

    Ok(PostconditionReport {
        passed: overall_passed,
        assertions: results,
    })
}

#[derive(Debug, Clone)]
enum AssertionSpec {
    HttpStatus {
        expected: u16,
    },
    DomContains {
        text: String,
        selector: Option<String>,
        case_insensitive: bool,
    },
    JsonPathEquals {
        path: String,
        expected: Value,
    },
}

fn evaluate_assertion<'a>(
    spec: &AssertionSpec,
    context: &EvaluationContext<'a>,
) -> Result<(AssertionKind, AssertionOutcome), PostconditionError> {
    match spec {
        AssertionSpec::HttpStatus { expected } => {
            let http = context.http.ok_or(PostconditionError::MissingEvidence {
                kind: AssertionKind::HttpStatus,
            })?;

            if http.status == *expected {
                Ok((
                    AssertionKind::HttpStatus,
                    AssertionOutcome::Passed {
                        detail: Some(json!({ "status": http.status })),
                    },
                ))
            } else {
                Ok((
                    AssertionKind::HttpStatus,
                    AssertionOutcome::Failed {
                        code: AssertionFailureCode::HttpStatusMismatch,
                        message: format!("expected status {}, observed {}", expected, http.status),
                        expected: Some(json!({ "status": expected })),
                        observed: Some(json!({ "status": http.status })),
                    },
                ))
            }
        }
        AssertionSpec::DomContains {
            text,
            selector,
            case_insensitive,
        } => {
            let dom = context
                .dom
                .as_ref()
                .ok_or(PostconditionError::MissingEvidence {
                    kind: AssertionKind::DomContains,
                })?;

            let haystack = dom.html;
            let needle = text.as_str();
            let found = if *case_insensitive {
                haystack.to_lowercase().contains(&needle.to_lowercase())
            } else {
                haystack.contains(needle)
            };

            if found {
                Ok((
                    AssertionKind::DomContains,
                    AssertionOutcome::Passed {
                        detail: Some(json!({
                            "expected_selector": selector,
                            "selector": dom.selector,
                            "matched": true
                        })),
                    },
                ))
            } else {
                Ok((
                    AssertionKind::DomContains,
                    AssertionOutcome::Failed {
                        code: AssertionFailureCode::DomTextMissing,
                        message: "expected DOM excerpt to contain target text".into(),
                        expected: Some(Value::String(REDACTED.into())),
                        observed: Some(json!({
                            "selector": dom.selector,
                            "expected_selector": selector,
                            "matched": false
                        })),
                    },
                ))
            }
        }
        AssertionSpec::JsonPathEquals { path, expected } => {
            let json_value = context.json.ok_or(PostconditionError::MissingEvidence {
                kind: AssertionKind::JsonPathEquals,
            })?;

            let tokens = parse_json_path(path).map_err(|message| PostconditionError::Invalid {
                message: format!("invalid json_path '{}': {}", path, message),
            })?;

            match resolve_json_path(json_value, &tokens) {
                None => Ok((
                    AssertionKind::JsonPathEquals,
                    AssertionOutcome::Failed {
                        code: AssertionFailureCode::JsonPathMissing,
                        message: format!("json path '{}' did not resolve", path),
                        expected: Some(sanitise_value(expected)),
                        observed: None,
                    },
                )),
                Some(observed) if observed == expected => Ok((
                    AssertionKind::JsonPathEquals,
                    AssertionOutcome::Passed {
                        detail: Some(json!({
                            "path": path,
                            "value": sanitise_value(observed),
                        })),
                    },
                )),
                Some(observed) => Ok((
                    AssertionKind::JsonPathEquals,
                    AssertionOutcome::Failed {
                        code: AssertionFailureCode::JsonPathPredicateFailed,
                        message: format!("json path '{}' value mismatch", path),
                        expected: Some(sanitise_value(expected)),
                        observed: Some(sanitise_value(observed)),
                    },
                )),
            }
        }
    }
}

fn parse_spec(raw: &Value) -> Result<Vec<AssertionSpec>, PostconditionError> {
    match raw {
        Value::Array(items) => parse_assertion_array(items),
        Value::Object(map) => {
            if let Some(assertions) = map.get("assertions") {
                match assertions {
                    Value::Array(items) => parse_assertion_array(items),
                    _ => Err(PostconditionError::Invalid {
                        message: "`assertions` must be an array".into(),
                    }),
                }
            } else if map.contains_key("type") {
                Ok(vec![parse_assertion(raw)?])
            } else {
                Err(PostconditionError::Unsupported {
                    type_name: describe_object_shape(map),
                })
            }
        }
        _ => Err(PostconditionError::Invalid {
            message: "postcondition must be an object or array".into(),
        }),
    }
}

fn parse_assertion_array(items: &[Value]) -> Result<Vec<AssertionSpec>, PostconditionError> {
    if items.is_empty() {
        return Err(PostconditionError::Invalid {
            message: "assertions array must not be empty".into(),
        });
    }

    items.iter().map(parse_assertion).collect()
}

fn parse_assertion(value: &Value) -> Result<AssertionSpec, PostconditionError> {
    let obj = value.as_object().ok_or(PostconditionError::Invalid {
        message: "postcondition assertion must be an object".into(),
    })?;
    let type_name = obj
        .get("type")
        .and_then(Value::as_str)
        .ok_or(PostconditionError::Invalid {
            message: "postcondition assertion missing 'type' field".into(),
        })?;

    match type_name {
        "http_status" => {
            let expected =
                obj.get("equals")
                    .and_then(Value::as_u64)
                    .ok_or(PostconditionError::Invalid {
                        message: "http_status assertion requires numeric 'equals'".into(),
                    })?;
            let expected_u16 =
                u16::try_from(expected).map_err(|_| PostconditionError::Invalid {
                    message: "http_status 'equals' must fit in u16".into(),
                })?;
            Ok(AssertionSpec::HttpStatus {
                expected: expected_u16,
            })
        }
        "dom_contains" => {
            let text =
                obj.get("text")
                    .and_then(Value::as_str)
                    .ok_or(PostconditionError::Invalid {
                        message: "dom_contains assertion requires 'text'".into(),
                    })?;
            let selector = obj
                .get("selector")
                .and_then(Value::as_str)
                .map(ToString::to_string);
            let case_insensitive = obj
                .get("case_insensitive")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            Ok(AssertionSpec::DomContains {
                text: text.to_string(),
                selector,
                case_insensitive,
            })
        }
        "json_path" => {
            let path =
                obj.get("path")
                    .and_then(Value::as_str)
                    .ok_or(PostconditionError::Invalid {
                        message: "json_path assertion requires 'path'".into(),
                    })?;
            let expected = obj.get("equals").ok_or(PostconditionError::Invalid {
                message: "json_path assertion requires 'equals'".into(),
            })?;
            Ok(AssertionSpec::JsonPathEquals {
                path: path.to_string(),
                expected: expected.clone(),
            })
        }
        other => Err(PostconditionError::Unsupported {
            type_name: other.to_string(),
        }),
    }
}

#[derive(Debug)]
enum PathToken {
    Field(String),
    Index(usize),
}

fn parse_json_path(path: &str) -> Result<Vec<PathToken>, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("path cannot be empty".into());
    }
    if !trimmed.starts_with('$') {
        return Err("path must start with '$'".into());
    }

    let mut tokens = Vec::new();
    let mut rest = &trimmed[1..];

    while !rest.is_empty() {
        if let Some(stripped) = rest.strip_prefix('.') {
            rest = stripped;
            if rest.is_empty() {
                return Err("path cannot end with '.'".into());
            }
            let len = rest.find(['.', '[']).unwrap_or(rest.len());
            if len == 0 {
                return Err("field name after '.' cannot be empty".into());
            }
            let field = &rest[..len];
            tokens.push(PathToken::Field(field.to_string()));
            rest = &rest[len..];
        } else if let Some(stripped) = rest.strip_prefix('[') {
            rest = stripped;
            let closing = rest.find(']').ok_or("missing closing ']' in index")?;
            let index_str = &rest[..closing];
            if index_str.is_empty() {
                return Err("array index cannot be empty".into());
            }
            let index = index_str
                .parse::<usize>()
                .map_err(|_| "array index must be a non-negative integer")?;
            tokens.push(PathToken::Index(index));
            rest = &rest[closing + 1..];
        } else {
            let ch = rest.as_bytes()[0] as char;
            return Err(format!("unexpected character '{ch}' in path"));
        }
    }

    Ok(tokens)
}

fn resolve_json_path<'a>(value: &'a Value, tokens: &[PathToken]) -> Option<&'a Value> {
    let mut current = value;
    for token in tokens {
        match (token, current) {
            (PathToken::Field(name), Value::Object(map)) => {
                current = map.get(name)?;
            }
            (PathToken::Index(index), Value::Array(items)) => {
                current = items.get(*index)?;
            }
            _ => return None,
        }
    }
    Some(current)
}

fn sanitise_value(value: &Value) -> Value {
    match value {
        Value::String(_) => Value::String(REDACTED.into()),
        Value::Array(items) => Value::Array(items.iter().map(sanitise_value).collect()),
        Value::Object(map) => {
            let mut redacted = Map::with_capacity(map.len());
            for (key, value) in map {
                redacted.insert(key.clone(), sanitise_value(value));
            }
            Value::Object(redacted)
        }
        other => other.clone(),
    }
}

fn describe_object_shape(map: &Map<String, Value>) -> String {
    let mut keys: Vec<&str> = map.keys().map(String::as_str).collect();
    keys.sort_unstable();
    format!("object_with_fields:{}", keys.join(","))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn http_status_passes_when_expected() {
        let spec = json!({
            "assertions": [
                { "type": "http_status", "equals": 200 }
            ]
        });
        let ctx = EvaluationContext {
            http: Some(HttpContext { status: 200 }),
            json: None,
            dom: None,
        };

        let report = match evaluate_postcondition(&spec, &ctx) {
            Ok(report) => report,
            Err(err) => panic!("unexpected evaluation error: {err}"),
        };

        assert!(report.passed);
        assert_eq!(report.assertions.len(), 1);
        match &report.assertions[0].outcome {
            AssertionOutcome::Passed {
                detail: Some(detail),
            } => {
                assert_eq!(detail["status"], json!(200));
            }
            AssertionOutcome::Passed { detail: None } => panic!("expected detail in assertion"),
            other => panic!("unexpected outcome: {:?}", other),
        }
    }

    #[test]
    fn http_status_failure_includes_expected_and_observed() {
        let spec = json!({ "type": "http_status", "equals": 201 });
        let ctx = EvaluationContext {
            http: Some(HttpContext { status: 500 }),
            json: None,
            dom: None,
        };

        let report = match evaluate_postcondition(&spec, &ctx) {
            Ok(report) => report,
            Err(err) => panic!("unexpected evaluation error: {err}"),
        };

        assert!(!report.passed);
        match &report.assertions[0].outcome {
            AssertionOutcome::Failed {
                code,
                expected: Some(expected),
                observed: Some(observed),
                ..
            } => {
                assert_eq!(*code, AssertionFailureCode::HttpStatusMismatch);
                assert_eq!(expected["status"], json!(201u16));
                assert_eq!(observed["status"], json!(500u16));
            }
            AssertionOutcome::Failed {
                expected, observed, ..
            } => panic!(
                "expected both expected and observed values, got {:?} and {:?}",
                expected, observed
            ),
            other => panic!("unexpected outcome: {:?}", other),
        }
    }

    #[test]
    fn dom_contains_respects_case_insensitive_flag() {
        let spec = json!({
            "type": "dom_contains",
            "text": "Success",
            "case_insensitive": true
        });
        let ctx = EvaluationContext {
            http: None,
            json: None,
            dom: Some(DomContext {
                selector: Some("#status"),
                html: "<div id=\"status\">success!</div>",
            }),
        };

        let report = match evaluate_postcondition(&spec, &ctx) {
            Ok(report) => report,
            Err(err) => panic!("unexpected evaluation error: {err}"),
        };

        assert!(report.passed);
    }

    #[test]
    fn json_path_equals_verifies_value() {
        let spec = json!({
            "assertions": [
                { "type": "json_path", "path": "$.status", "equals": "ok" }
            ]
        });
        let payload = json!({ "status": "ok" });
        let ctx = EvaluationContext {
            http: None,
            json: Some(&payload),
            dom: None,
        };

        let report = match evaluate_postcondition(&spec, &ctx) {
            Ok(report) => report,
            Err(err) => panic!("unexpected evaluation error: {err}"),
        };
        assert!(report.passed);
    }

    #[test]
    fn json_path_missing_reports_failure() {
        let spec = json!({
            "type": "json_path",
            "path": "$.missing",
            "equals": true
        });
        let payload = json!({ "status": true });
        let ctx = EvaluationContext {
            http: None,
            json: Some(&payload),
            dom: None,
        };

        let report = match evaluate_postcondition(&spec, &ctx) {
            Ok(report) => report,
            Err(err) => panic!("unexpected evaluation error: {err}"),
        };
        assert!(!report.passed);
        match &report.assertions[0].outcome {
            AssertionOutcome::Failed { code, .. } => {
                assert_eq!(*code, AssertionFailureCode::JsonPathMissing);
            }
            other => panic!("unexpected outcome: {:?}", other),
        }
    }

    #[test]
    fn unsupported_type_returns_error() {
        let spec = json!({
            "type": "sql",
            "query": "select 1"
        });
        match evaluate_postcondition(&spec, &EvaluationContext::default()) {
            Err(PostconditionError::Unsupported { .. }) => {}
            Err(err) => panic!("unexpected error variant: {err}"),
            Ok(report) => panic!("expected error, received report: {:?}", report),
        }
    }
}
