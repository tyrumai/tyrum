use std::net::SocketAddr;

use anyhow::Context;
use axum::{Router, response::Html, routing::get};
use serde_json::json;
use tokio::task::JoinHandle;
use tyrum_executor_web::{BrowserFlavor, WebActionOutcome, WebExecutorError, execute_web_action};
use tyrum_shared::planner::{ActionArguments, ActionPrimitive, ActionPrimitiveKind};

const FIXTURE_HTML: &str = r#"
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <title>Fixture Form</title>
</head>
<body>
    <main>
        <h1>Book a Call</h1>
        <form action="/submit" method="post">
            <label>
                Name
                <input name="name" type="text" />
            </label>
            <label>
                Preferred time
                <input name="slot" type="time" />
            </label>
            <button type="submit">Request booking</button>
        </form>
    </main>
</body>
</html>
"#;

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn launches_browser_and_fetches_fixture() -> anyhow::Result<()> {
    let (addr, handle) = start_fixture_server().await?;
    let url = format!("http://{addr}");

    let args = ActionArguments::from_iter([(String::from("url"), json!(url))]);
    let primitive = ActionPrimitive::new(ActionPrimitiveKind::Web, args);

    let outcome = match execute_web_action(&primitive).await {
        Ok(outcome) => outcome,
        Err(WebExecutorError::BrowserUnavailable { details }) => {
            tracing::warn!(%details, "Skipping web executor fixture test; no supported browsers");
            handle.abort();
            let _ = handle.await;
            return Ok(());
        }
        Err(err) => return Err(err.into()),
    };

    assert_page_snapshot(&outcome, &url);

    handle.abort();
    let _ = handle.await;

    Ok(())
}

fn assert_page_snapshot(outcome: &WebActionOutcome, expected_url: &str) {
    assert_eq!(outcome.current_url, expected_url);
    assert_eq!(outcome.title, "Fixture Form");
    assert!(
        outcome
            .html
            .contains("<form action=\"/submit\" method=\"post\">")
            && outcome.html.contains("name=\"slot\"")
    );
    assert!(
        matches!(
            outcome.browser,
            BrowserFlavor::Chromium | BrowserFlavor::Webkit
        ),
        "unexpected browser fallback: {:?}",
        outcome.browser
    );
}

async fn start_fixture_server() -> anyhow::Result<(SocketAddr, JoinHandle<()>)> {
    let app = Router::new().route("/", get(|| async { Html(FIXTURE_HTML) }));
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .context("bind fixture listener")?;
    let addr = listener.local_addr().context("read listener address")?;

    let handle = tokio::spawn(async move {
        if let Err(err) = axum::serve(listener, app.into_make_service()).await {
            tracing::warn!(%err, "fixture server exited with error");
        }
    });

    Ok((addr, handle))
}
