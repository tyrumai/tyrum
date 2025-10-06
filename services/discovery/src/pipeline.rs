use std::time::Duration;

use tracing::debug;

/// Request envelope supplied to discovery strategies.
///
/// The `subject` should be a sanitized descriptor such as a domain, MCP
/// capability name, or structured API identifier. Callers are responsible for
/// removing credentials or user-scoped tokens before construction to keep log
/// output compliant.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveryRequest {
    pub subject: String,
}

impl DiscoveryRequest {
    /// Returns a human-readable but sanitized subject for logging.
    pub fn sanitized_subject(&self) -> &str {
        &self.subject
    }
}

/// Result of a discovery attempt.
///
/// The enum will expand as executors land. Planned additions include variants
/// for consent escalation, partial matches, and cached connectors once the
/// policy gate owns credential brokering.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DiscoveryOutcome {
    /// Discovery succeeded and returns sanitized connector metadata for
    /// executor hand-off.
    Found(DiscoveryConnector),
    /// No strategy produced a match; downstream callers can offer manual
    /// fallback or prompt for more context.
    NotFound,
    /// Upstream requested a retry (rate limit, temporary outage, etc.). This
    /// will evolve to include consent escalation once policy hooks land.
    RetryLater { retry_after: Option<Duration> },
}

impl DiscoveryOutcome {
    fn continues(&self) -> bool {
        matches!(self, DiscoveryOutcome::NotFound)
    }
}

/// Connector metadata surfaced back to executors.
///
/// The `locator` will eventually carry structured connection data (endpoint
/// URIs, tool identifiers) once we integrate with the planner memory service.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveryConnector {
    pub strategy: DiscoveryStrategy,
    pub locator: String,
}

/// Enumerates the strategies executed by the pipeline.
///
/// The order here mirrors the MVP cut outlined in `docs/product_concept_v1.md`
/// and should stay in sync with the planner's decision tree.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum DiscoveryStrategy {
    Mcp,
    StructuredApi,
    GenericHttp,
}

/// Defines the contract for executing discovery strategies in a fixed order.
pub trait DiscoveryPipeline {
    fn try_mcp(&self, request: &DiscoveryRequest) -> DiscoveryOutcome;

    fn try_structured_api(&self, request: &DiscoveryRequest) -> DiscoveryOutcome;

    fn try_generic_http(&self, request: &DiscoveryRequest) -> DiscoveryOutcome;

    /// Executes the discovery strategies in priority order, short-circuiting on
    /// the first non-`NotFound` outcome.
    fn discover(&self, request: &DiscoveryRequest) -> DiscoveryOutcome {
        debug!(subject = %request.sanitized_subject(), "Starting discovery");

        debug!(
            subject = %request.sanitized_subject(),
            strategy = ?DiscoveryStrategy::Mcp,
            "Running discovery step",
        );
        match self.try_mcp(request) {
            DiscoveryOutcome::NotFound => {
                debug!(strategy = ?DiscoveryStrategy::Mcp, "Strategy returned NotFound");
            }
            outcome => {
                debug!(
                    strategy = ?DiscoveryStrategy::Mcp,
                    outcome = ?outcome,
                    "Strategy resolved",
                );
                return outcome;
            }
        }

        debug!(
            subject = %request.sanitized_subject(),
            strategy = ?DiscoveryStrategy::StructuredApi,
            "Running discovery step",
        );
        match self.try_structured_api(request) {
            DiscoveryOutcome::NotFound => {
                debug!(
                    strategy = ?DiscoveryStrategy::StructuredApi,
                    "Strategy returned NotFound",
                );
            }
            outcome => {
                debug!(
                    strategy = ?DiscoveryStrategy::StructuredApi,
                    outcome = ?outcome,
                    "Strategy resolved",
                );
                return outcome;
            }
        }

        debug!(
            subject = %request.sanitized_subject(),
            strategy = ?DiscoveryStrategy::GenericHttp,
            "Running discovery step",
        );
        let outcome = self.try_generic_http(request);
        if outcome.continues() {
            debug!(
                strategy = ?DiscoveryStrategy::GenericHttp,
                "Strategy returned NotFound",
            );
        } else {
            debug!(
                strategy = ?DiscoveryStrategy::GenericHttp,
                outcome = ?outcome,
                "Strategy resolved",
            );
        }
        outcome
    }
}

/// Stub pipeline used while executors are wired in.
#[derive(Default)]
pub struct DefaultDiscoveryPipeline;

impl DefaultDiscoveryPipeline {
    /// Creates a pipeline stub useful for tests or planner scaffolding. All
    /// strategies currently return `NotFound` while the executor wiring lands.
    pub fn new() -> Self {
        Self
    }
}

impl DiscoveryPipeline for DefaultDiscoveryPipeline {
    fn try_mcp(&self, _request: &DiscoveryRequest) -> DiscoveryOutcome {
        DiscoveryOutcome::NotFound
    }

    fn try_structured_api(&self, _request: &DiscoveryRequest) -> DiscoveryOutcome {
        DiscoveryOutcome::NotFound
    }

    fn try_generic_http(&self, _request: &DiscoveryRequest) -> DiscoveryOutcome {
        // TODO: support credential-scoped discovery without leaking secrets.
        DiscoveryOutcome::NotFound
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct ScriptedPipeline {
        calls: RefCell<Vec<DiscoveryStrategy>>,
        mcp_outcome: DiscoveryOutcome,
        structured_outcome: DiscoveryOutcome,
        generic_outcome: DiscoveryOutcome,
    }

    impl ScriptedPipeline {
        fn new(
            mcp_outcome: DiscoveryOutcome,
            structured_outcome: DiscoveryOutcome,
            generic_outcome: DiscoveryOutcome,
        ) -> Self {
            Self {
                calls: RefCell::new(Vec::new()),
                mcp_outcome,
                structured_outcome,
                generic_outcome,
            }
        }

        fn calls(&self) -> Vec<DiscoveryStrategy> {
            self.calls.borrow().clone()
        }
    }

    impl DiscoveryPipeline for ScriptedPipeline {
        fn try_mcp(&self, _request: &DiscoveryRequest) -> DiscoveryOutcome {
            self.calls.borrow_mut().push(DiscoveryStrategy::Mcp);
            self.mcp_outcome.clone()
        }

        fn try_structured_api(&self, _request: &DiscoveryRequest) -> DiscoveryOutcome {
            self.calls
                .borrow_mut()
                .push(DiscoveryStrategy::StructuredApi);
            self.structured_outcome.clone()
        }

        fn try_generic_http(&self, _request: &DiscoveryRequest) -> DiscoveryOutcome {
            self.calls.borrow_mut().push(DiscoveryStrategy::GenericHttp);
            self.generic_outcome.clone()
        }
    }

    fn request() -> DiscoveryRequest {
        DiscoveryRequest {
            subject: "calendar:events".into(),
        }
    }

    #[test]
    fn runs_strategies_in_order_when_not_found() {
        let pipeline = ScriptedPipeline::new(
            DiscoveryOutcome::NotFound,
            DiscoveryOutcome::NotFound,
            DiscoveryOutcome::NotFound,
        );

        let outcome = pipeline.discover(&request());

        assert_eq!(outcome, DiscoveryOutcome::NotFound);
        assert_eq!(
            pipeline.calls(),
            vec![
                DiscoveryStrategy::Mcp,
                DiscoveryStrategy::StructuredApi,
                DiscoveryStrategy::GenericHttp,
            ],
        );
    }

    #[test]
    fn short_circuits_on_first_successful_strategy() {
        let connector = DiscoveryConnector {
            strategy: DiscoveryStrategy::StructuredApi,
            locator: "structured://crm.accounts".into(),
        };
        let pipeline = ScriptedPipeline::new(
            DiscoveryOutcome::NotFound,
            DiscoveryOutcome::Found(connector.clone()),
            DiscoveryOutcome::Found(DiscoveryConnector {
                strategy: DiscoveryStrategy::GenericHttp,
                locator: "https://example.com".into(),
            }),
        );

        let outcome = pipeline.discover(&request());

        assert_eq!(outcome, DiscoveryOutcome::Found(connector));
        assert_eq!(
            pipeline.calls(),
            vec![DiscoveryStrategy::Mcp, DiscoveryStrategy::StructuredApi],
        );
    }
}
