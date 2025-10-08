use serde_json::{self, Value};
use tyrum_wallet::{
    SpendAuthorizeRequest, SpendAuthorizeResponse, Thresholds, authorize_with_thresholds,
};

const APPROVE_REQUEST: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/authorize_approve_request.json"
));
const APPROVE_RESPONSE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/authorize_approve_response.json"
));

const ESCALATE_REQUEST: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/authorize_escalate_request.json"
));
const ESCALATE_RESPONSE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/authorize_escalate_response.json"
));

const DENY_REQUEST: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/authorize_deny_request.json"
));
const DENY_RESPONSE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/authorize_deny_response.json"
));

struct Scenario {
    request: &'static str,
    expected: &'static str,
}

const SCENARIOS: &[Scenario] = &[
    Scenario {
        request: APPROVE_REQUEST,
        expected: APPROVE_RESPONSE,
    },
    Scenario {
        request: ESCALATE_REQUEST,
        expected: ESCALATE_RESPONSE,
    },
    Scenario {
        request: DENY_REQUEST,
        expected: DENY_RESPONSE,
    },
];

#[test]
fn fixtures_cover_authorization_contract() {
    let thresholds = Thresholds {
        auto_approve_minor_units: 10_000,
        hard_deny_minor_units: 50_000,
    };

    for scenario in SCENARIOS {
        let payload: SpendAuthorizeRequest = serde_json::from_str(scenario.request).unwrap();
        let expected: SpendAuthorizeResponse = serde_json::from_str(scenario.expected).unwrap();

        let actual = authorize_with_thresholds(payload, thresholds);

        let actual_json: Value = serde_json::to_value(actual).unwrap();
        let expected_json: Value = serde_json::to_value(expected).unwrap();

        assert_eq!(actual_json, expected_json, "scenario failed");
    }
}
