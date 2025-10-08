#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::{env, path::Path, process::Stdio};

use serde_json::{Map as JsonMap, Value, json};
use tempfile::tempdir;
use tokio::process::Command;
use tyrum_executor_android::{AndroidActionKind, AndroidExecutor, AndroidExecutorConfig};
use tyrum_shared::planner::{ActionPrimitive, ActionPrimitiveKind};

const SAMPLE_APK: &str = "services/executor_android/tests/fixtures/ApiDemos-debug.apk";
const SAMPLE_PACKAGE: &str = "io.appium.android.apis";
const SAMPLE_ACTIVITY: &str = ".ApiDemos";

#[tokio::test]
#[ignore]
async fn executes_launch_and_tap_primitives() -> Result<(), Box<dyn std::error::Error>> {
    let default_target =
        env::var("ANDROID_EXECUTOR_TARGET").unwrap_or_else(|_| "localhost:5555".to_string());
    unsafe {
        env::set_var("ANDROID_EXECUTOR_TARGET", &default_target);
        env::set_var("ANDROID_EXECUTOR_COMMAND_TIMEOUT_SECONDS", "120");
    }

    let artifact_dir = tempdir()?;
    unsafe {
        env::set_var("ANDROID_EXECUTOR_ARTIFACT_DIR", artifact_dir.path());
    }

    let config = AndroidExecutorConfig::from_env();
    let adb_path = config.adb_path().to_path_buf();
    let target = config.target().to_string();
    let executor = AndroidExecutor::new(config);

    ensure_device_ready(&adb_path, &target).await?;
    install_sample_apk(&adb_path, &target).await?;

    let launch_outcome = executor
        .execute(&primitive_launch_app())
        .await
        .expect("launch app primitive succeeds");
    assert_eq!(launch_outcome.kind, AndroidActionKind::LaunchApp);
    assert!(Path::new(&launch_outcome.screenshot.path).exists());

    let tap_outcome = executor
        .execute(&primitive_tap_coordinates())
        .await
        .expect("tap primitive succeeds");
    assert_eq!(tap_outcome.kind, AndroidActionKind::Tap);
    assert!(Path::new(&tap_outcome.screenshot.path).exists());

    uninstall_sample_apk(&adb_path, &target).await?;

    Ok(())
}

fn primitive_launch_app() -> ActionPrimitive {
    let mut args = JsonMap::new();
    args.insert("operation".into(), Value::String("launch_app".into()));
    args.insert("package".into(), Value::String(SAMPLE_PACKAGE.into()));
    args.insert("activity".into(), Value::String(SAMPLE_ACTIVITY.into()));
    args.insert(
        "wait_ms".into(),
        Value::Number(serde_json::Number::from(2000)),
    );
    ActionPrimitive::new(ActionPrimitiveKind::Android, args)
}

fn primitive_tap_coordinates() -> ActionPrimitive {
    let mut args = JsonMap::new();
    args.insert("operation".into(), Value::String("tap".into()));
    args.insert(
        "coordinates".into(),
        json!({
            "x": 540,
            "y": 1200
        }),
    );
    args.insert(
        "wait_ms".into(),
        Value::Number(serde_json::Number::from(500)),
    );
    ActionPrimitive::new(ActionPrimitiveKind::Android, args)
}

async fn ensure_device_ready(
    adb_path: &Path,
    target: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    if target.contains(':') {
        run_host_adb(adb_path, &[], &["connect", target]).await?;
    }
    run_host_adb(adb_path, &["-s", target], &["wait-for-device"]).await?;
    Ok(())
}

async fn install_sample_apk(
    adb_path: &Path,
    target: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    run_host_adb(adb_path, &["-s", target], &["install", "-r", SAMPLE_APK]).await
}

async fn uninstall_sample_apk(
    adb_path: &Path,
    target: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    run_host_adb(adb_path, &["-s", target], &["uninstall", SAMPLE_PACKAGE]).await
}

async fn run_host_adb(
    adb_path: &Path,
    prefix: &[&str],
    args: &[&str],
) -> Result<(), Box<dyn std::error::Error>> {
    let mut command = Command::new(adb_path);
    command.args(prefix);
    command.args(args);
    command.stdin(Stdio::null());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    let output = command.output().await?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("adb command failed: {stderr}").into());
    }
    Ok(())
}
