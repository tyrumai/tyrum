#![allow(clippy::expect_used, clippy::unwrap_used)]

mod common;

use std::time::Duration;

use anyhow::Result;
use common::NatsFixture;
use tyrum_watchers::{JetStreamClient, JetStreamConfig};

#[tokio::test]
async fn jetstream_publish_and_consume_roundtrip() -> Result<()> {
    let fixture = match NatsFixture::start().await {
        Ok(fixture) => fixture,
        Err(err) => {
            if err.chain().any(|cause| {
                let message = cause.to_string();
                message.contains("No such file or directory")
                    || message.contains("client error (Connect)")
            }) {
                eprintln!(
                    "skipping jetstream_publish_and_consume_roundtrip: docker unavailable ({err})"
                );
                return Ok(());
            }

            return Err(err);
        }
    };

    let config = JetStreamConfig::new(
        fixture.url().to_string(),
        "watchers_integration_stream",
        "watchers.integration",
        "watchers_integration_consumer",
        "watchers_integration_processor",
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
