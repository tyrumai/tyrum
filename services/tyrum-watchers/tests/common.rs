use anyhow::{Context, Result};
use testcontainers::{
    ContainerAsync, GenericImage, ImageExt,
    core::{IntoContainerPort, WaitFor, wait::HttpWaitStrategy},
    runners::AsyncRunner,
};

pub const NATS_IMAGE: &str = "nats";
pub const NATS_TAG: &str = "2.10-alpine";
pub const NATS_PORT: u16 = 4222;

pub struct NatsFixture {
    #[allow(dead_code)]
    container: ContainerAsync<GenericImage>,
    url: String,
}

impl NatsFixture {
    /// Starts a disposable JetStream container for integration tests.
    ///
    /// # Errors
    ///
    /// Returns an error when the Docker container cannot be provisioned or the port mapping fails.
    pub async fn start() -> Result<Self> {
        let image = GenericImage::new(NATS_IMAGE, NATS_TAG)
            .with_exposed_port(NATS_PORT.tcp())
            .with_wait_for(WaitFor::http(
                HttpWaitStrategy::new("/healthz?js-enabled=true")
                    .with_port(8222.tcp())
                    .with_expected_status_code(200u16),
            ))
            .with_cmd(["-js", "-m", "8222"]);

        let container = image
            .start()
            .await
            .context("start nats jetstream container")?;
        let host_port = container
            .get_host_port_ipv4(NATS_PORT.tcp())
            .await
            .context("map nats port")?;

        let url = format!("nats://127.0.0.1:{host_port}");

        Ok(Self { container, url })
    }

    /// Returns the NATS connection URL exposed by the container.
    #[must_use]
    pub fn url(&self) -> &str {
        &self.url
    }
}
