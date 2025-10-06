use std::net::SocketAddr;

use anyhow::Context;
use axum::{
    Form, Router,
    response::Html,
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::task::JoinHandle;
use tyrum_executor_web::{WebExecutorError, execute_web_action};
use tyrum_shared::planner::{ActionArguments, ActionPrimitive, ActionPrimitiveKind};

const FORM_HTML: &str = r#"
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

#[derive(Deserialize)]
struct BookingForm {
    name: String,
    slot: String,
}

#[tokio::test(flavor = "multi_thread")]
async fn form_action_executes_and_captures_confirmation() -> anyhow::Result<()> {
    let (addr, handle) = start_fixture_server().await?;
    let url = format!("http://{addr}");

    let primitive = ActionPrimitive::new(
        ActionPrimitiveKind::Web,
        into_args(json!({
            "url": url,
            "executor": "generic-web",
            "fields": [
                { "selector": "input[name='name']", "value": "Rosa Example", "redact": true },
                { "selector": "input[name='slot']", "value": "15:00" }
            ],
            "submit": {
                "selector": "button[type='submit']",
                "kind": "click",
                "wait_after_ms": 50
            },
            "snapshot_selector": "#confirmation"
        })),
    );

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

    assert_eq!(outcome.title, "Form Submitted");
    assert!(outcome.current_url.ends_with("/submit"));
    assert_eq!(outcome.dom_excerpt.selector, "#confirmation");
    assert!(!outcome.dom_excerpt.html.contains("Rosa Example"));
    assert!(outcome.dom_excerpt.html.contains("15:00"));
    assert!(outcome.dom_excerpt.html.contains("REDACTED"));

    assert_eq!(outcome.submitted_fields.len(), 2);
    assert_eq!(outcome.submitted_fields[0].selector, "input[name='name']");
    assert_eq!(outcome.submitted_fields[0].value, "REDACTED");
    assert!(outcome.submitted_fields[0].redacted);
    assert_eq!(outcome.submitted_fields[1].selector, "input[name='slot']");
    assert_eq!(outcome.submitted_fields[1].value, "15:00");
    assert!(!outcome.submitted_fields[1].redacted);

    handle.abort();
    let _ = handle.await;

    Ok(())
}

fn into_args(value: Value) -> ActionArguments {
    value
        .as_object()
        .expect("primitive args must be object")
        .clone()
}

async fn start_fixture_server() -> anyhow::Result<(SocketAddr, JoinHandle<()>)> {
    let app = Router::new()
        .route("/", get(|| async { Html(FORM_HTML) }))
        .route("/submit", post(handle_submission));

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

async fn handle_submission(Form(form): Form<BookingForm>) -> Html<String> {
    let body = format!(
        "<!doctype html>\n<html lang=\"en\">\n<head>\n    <meta charset=\"utf-8\" />\n    <title>Form Submitted</title>\n</head>\n<body>\n    <section id=\"confirmation\">\n        <h2>Appointment request processed</h2>\n        <dl>\n            <dt>Guest</dt>\n            <dd data-field=\"name\">{}</dd>\n            <dt>Preferred slot</dt>\n            <dd data-field=\"slot\">{}</dd>\n        </dl>\n        <p>We will reach out shortly with the confirmed details.</p>\n    </section>\n</body>\n</html>",
        html_escape::encode_text(&form.name),
        html_escape::encode_text(&form.slot)
    );

    Html(body)
}
