#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::time::Duration;

use anyhow::{Context, Result};
use sqlx::{PgPool, postgres::PgPoolOptions};
use testcontainers::{
    ContainerAsync, GenericImage, ImageExt,
    core::{IntoContainerPort, WaitFor},
    runners::AsyncRunner,
};

const POSTGRES_IMAGE: &str = "pgvector/pgvector";
const POSTGRES_TAG: &str = "pg16";
const POSTGRES_USER: &str = "tyrum";
const POSTGRES_PASSWORD: &str = "tyrum_dev_password";
const POSTGRES_DB: &str = "tyrum_dev";

pub struct TestPostgres {
    _container: ContainerAsync<GenericImage>,
    pool: PgPool,
}

impl TestPostgres {
    pub async fn start() -> Result<Self> {
        let image = GenericImage::new(POSTGRES_IMAGE, POSTGRES_TAG)
            .with_exposed_port(5432.tcp())
            .with_wait_for(WaitFor::message_on_stdout(
                "database system is ready to accept connections",
            ));

        let request = image
            .with_env_var("POSTGRES_USER", POSTGRES_USER)
            .with_env_var("POSTGRES_PASSWORD", POSTGRES_PASSWORD)
            .with_env_var("POSTGRES_DB", POSTGRES_DB);

        let container = request.start().await.context("start postgres container")?;
        let host_port = container
            .get_host_port_ipv4(5432.tcp())
            .await
            .context("map postgres port")?;

        let database_url = format!(
            "postgres://{}:{}@127.0.0.1:{}/{}",
            POSTGRES_USER, POSTGRES_PASSWORD, host_port, POSTGRES_DB
        );

        let pool = connect_with_retry(&database_url).await?;

        Ok(Self {
            _container: container,
            pool,
        })
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
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
                tokio::time::sleep(Duration::from_millis(200)).await;
                tracing::warn!(
                    attempts,
                    "waiting for postgres to accept connections: {err}"
                );
            }
            Err(err) => break Err(err.into()),
        }
    }
}
