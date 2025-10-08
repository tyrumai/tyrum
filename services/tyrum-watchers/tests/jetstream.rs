#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::time::Duration;

use anyhow::{Context, Result};
use testcontainers::{
    ContainerAsync, GenericImage, ImageExt,
    core::{IntoContainerPort, WaitFor, wait::HttpWaitStrategy},
    runners::AsyncRunner,
};
use tyrum_watchers::{JetStreamClient, JetStreamConfig};

const NATS_IMAGE: &str = "nats";
const NATS_TAG: &str = "2.10-alpine";
const NATS_PORT: u16 = 4222;

struct NatsFixture {
    #[allow(dead_code)]
    container: ContainerAsync<GenericImage>,
    url: String,
}

impl NatsFixture {
    async fn start() -> Result<Self> {
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
}

#[tokio::test]
async fn jetstream_publish_and_consume_roundtrip() -> Result<()> {
    let fixture = match NatsFixture::start().await {
        Ok(fixture) => fixture,
        Err(err) => {
            if err
                .chain()
                .any(|cause| cause.to_string().contains("No such file or directory"))
            {
                eprintln!(
                    "skipping jetstream_publish_and_consume_roundtrip: docker socket unavailable ({err})"
                );
                return Ok(());
            }

            return Err(err);
        }
    };

    let config = JetStreamConfig::new(
        fixture.url.clone(),
        "watchers_integration_stream",
        "watchers.integration",
        "watchers_integration_consumer",
        "tyrum-watchers-test",
    )?;
    let client = JetStreamClient::connect(config.clone()).await?;

    let health = client.health_check().await?;
    assert!(
        health.streams >= 1,
        "expected at least one stream, got {}",
        health.streams
    );

    let payload = br#"{"event":"demo"}"#.to_vec();
    client.publish_sample_event(&payload).await?;

    let received = client.consume_sample_event(Duration::from_secs(2)).await?;
    assert_eq!(received, Some(payload));

    Ok(())
}
