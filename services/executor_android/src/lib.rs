//! Android executor implementation for Tyrum.
//!
//! The executor issues `adb` commands against the shared emulator
//! (provisioned via `infra/docker-compose.yml`) to perform primitive
//! automation steps requested by the planner. Initial capabilities cover
//! launching an application and tapping either absolute coordinates or an
//! accessibility identifier. Each action captures a screenshot artifact so
//! postconditions can verify visual evidence.

use std::{
    env,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map as JsonMap, Value};
use thiserror::Error;
use tokio::{
    fs,
    process::Command,
    time::{sleep, timeout},
};
use tracing::{debug, trace, warn};
use tyrum_shared::planner::{ActionPrimitive, ActionPrimitiveKind};
use uuid::Uuid;

pub mod telemetry;

const DEFAULT_ADB_PATH: &str = "adb";
const DEFAULT_TARGET: &str = "localhost:5555";
const DEFAULT_ARTIFACT_DIR: &str = "artifacts/android";
const DEFAULT_COMMAND_TIMEOUT_SECS: u64 = 30;
const DEFAULT_LAUNCH_SETTLE_MS: u64 = 1_500;
const DEFAULT_TAP_SETTLE_MS: u64 = 500;
const SCREENSHOT_BASENAME: &str = "android-action";

/// Result alias for Android executor operations.
pub type Result<T> = std::result::Result<T, AndroidExecutorError>;

/// Summary of the executor sandbox returned via diagnostics endpoints.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AndroidSandboxSummary {
    /// Device selector passed to `adb -s`.
    pub target: String,
    /// Absolute path used when spawning the `adb` binary.
    pub adb_path: String,
    /// Directory where screenshot artifacts are persisted.
    pub artifact_dir: String,
    /// Timeout applied to individual `adb` invocations (seconds).
    pub command_timeout_secs: u64,
    /// Default stabilization delay after `launch_app` actions (milliseconds).
    pub launch_settle_ms: u64,
    /// Default stabilization delay after `tap` actions (milliseconds).
    pub tap_settle_ms: u64,
}

/// Outcome returned to the planner after executing an Android primitive.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AndroidActionOutcome {
    /// Primitive kind that was executed.
    pub kind: AndroidActionKind,
    /// Human-readable confirmation describing the action performed.
    pub confirmation: String,
    /// Screenshot artifact captured immediately after the action.
    pub screenshot: ScreenshotArtifact,
}

/// Metadata describing the captured screenshot artifact.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScreenshotArtifact {
    /// Filesystem path of the stored screenshot (relative to repository root when defaulted).
    pub path: String,
    /// UTC timestamp when the screenshot was captured.
    pub captured_at: DateTime<Utc>,
    /// MIME type for the captured artifact.
    pub content_type: String,
}

/// Android primitive kinds supported by the executor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AndroidActionKind {
    LaunchApp,
    Tap,
}

#[derive(Clone, Debug)]
pub struct AndroidExecutor {
    config: Arc<AndroidExecutorConfig>,
}

/// Configuration resolved from environment variables or defaults.
#[derive(Clone, Debug)]
pub struct AndroidExecutorConfig {
    adb_path: PathBuf,
    target: String,
    artifact_dir: PathBuf,
    command_timeout: Duration,
    launch_settle: Duration,
    tap_settle: Duration,
}

#[derive(Debug, Error)]
pub enum AndroidExecutorError {
    #[error("unsupported primitive kind {0:?}")]
    UnsupportedPrimitive(ActionPrimitiveKind),
    #[error("missing required argument '{0}'")]
    MissingArgument(&'static str),
    #[error("invalid argument '{argument}': {reason}")]
    InvalidArgumentValue {
        argument: &'static str,
        reason: String,
    },
    #[error("unsupported android action '{0}'")]
    UnsupportedAction(String),
    #[error("adb command '{command}' failed (status {status:?}): {stderr}")]
    AdbCommandFailed {
        command: String,
        status: Option<i32>,
        stderr: String,
    },
    #[error("adb command '{command}' timed out after {timeout_secs} seconds")]
    AdbCommandTimedOut { command: String, timeout_secs: u64 },
    #[error("adb command '{command}' output was not valid UTF-8: {source}")]
    CommandOutputUtf8 {
        command: String,
        #[source]
        source: std::string::FromUtf8Error,
    },
    #[error("accessibility node '{accessibility_id}' not found")]
    AccessibilityNodeNotFound { accessibility_id: String },
    #[error("failed to parse bounds '{value}' for accessibility node")]
    InvalidBounds { value: String },
    #[error("ui hierarchy dump missing xml payload")]
    UiHierarchyMissingXml,
    #[error("ui hierarchy parsing error: {0}")]
    UiHierarchyParse(#[from] quick_xml::Error),
    #[error("ui hierarchy attribute error: {0}")]
    UiHierarchyAttr(#[from] quick_xml::events::attributes::AttrError),
    #[error("screenshot capture returned no data")]
    EmptyScreenshot,
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

impl AndroidExecutorConfig {
    /// Resolve executor configuration from environment variables.
    pub fn from_env() -> Self {
        let adb_path =
            env::var("ANDROID_EXECUTOR_ADB_PATH").unwrap_or_else(|_| DEFAULT_ADB_PATH.to_string());
        let target =
            env::var("ANDROID_EXECUTOR_TARGET").unwrap_or_else(|_| DEFAULT_TARGET.to_string());
        let artifact_dir = env::var("ANDROID_EXECUTOR_ARTIFACT_DIR")
            .unwrap_or_else(|_| DEFAULT_ARTIFACT_DIR.to_string());
        let command_timeout = env::var("ANDROID_EXECUTOR_COMMAND_TIMEOUT_SECONDS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .map(Duration::from_secs)
            .unwrap_or_else(|| Duration::from_secs(DEFAULT_COMMAND_TIMEOUT_SECS));
        let launch_settle = env::var("ANDROID_EXECUTOR_LAUNCH_SETTLE_MS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(DEFAULT_LAUNCH_SETTLE_MS);
        let tap_settle = env::var("ANDROID_EXECUTOR_TAP_SETTLE_MS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(DEFAULT_TAP_SETTLE_MS);

        Self {
            adb_path: PathBuf::from(adb_path),
            target,
            artifact_dir: PathBuf::from(artifact_dir),
            command_timeout,
            launch_settle: Duration::from_millis(launch_settle),
            tap_settle: Duration::from_millis(tap_settle),
        }
    }

    pub fn adb_path(&self) -> &Path {
        &self.adb_path
    }

    pub fn target(&self) -> &str {
        &self.target
    }

    pub fn artifact_dir(&self) -> &Path {
        &self.artifact_dir
    }

    pub fn command_timeout(&self) -> Duration {
        self.command_timeout
    }

    pub fn launch_settle(&self) -> Duration {
        self.launch_settle
    }

    pub fn tap_settle(&self) -> Duration {
        self.tap_settle
    }
}

impl AndroidExecutor {
    /// Instantiate a new executor with the provided configuration.
    pub fn new(config: AndroidExecutorConfig) -> Self {
        Self {
            config: Arc::new(config),
        }
    }

    /// Borrow the underlying configuration.
    pub fn config(&self) -> &AndroidExecutorConfig {
        &self.config
    }

    /// Execute an Android primitive, returning confirmation data and screenshot artifact.
    pub async fn execute(&self, primitive: &ActionPrimitive) -> Result<AndroidActionOutcome> {
        ensure_android_primitive(primitive)?;
        let action = parse_android_action(&primitive.args)?;

        self.ensure_connection().await?;

        let telemetry_context = telemetry::AttemptContext::new(action.kind(), self.config.target());
        let executor = self.clone();
        let action_clone = action.clone();
        let (result, _elapsed) = telemetry::record_attempt(&telemetry_context, async move {
            executor.perform_action(&action_clone).await
        })
        .await;

        result
    }

    async fn perform_action(&self, action: &AndroidAction) -> Result<AndroidActionOutcome> {
        match action {
            AndroidAction::LaunchApp(spec) => self.launch_app(spec).await,
            AndroidAction::Tap(spec) => self.tap(spec).await,
        }
    }

    async fn ensure_connection(&self) -> Result<()> {
        if self.config.target().contains(':') {
            let args = vec!["connect".to_string(), self.config.target().to_string()];
            let _ = self.run_adb("connect", args).await?;
        }
        Ok(())
    }

    async fn launch_app(&self, spec: &LaunchApp) -> Result<AndroidActionOutcome> {
        let confirmation = if let Some(activity) = spec.activity.as_deref() {
            let component = compose_component(&spec.package, activity);
            let args = vec![
                "am".to_string(),
                "start".to_string(),
                "-W".to_string(),
                "-n".to_string(),
                component.clone(),
            ];
            self.run_adb_shell("am start", args).await?;
            format!("Launched {component}")
        } else {
            let args = vec![
                "monkey".to_string(),
                "-p".to_string(),
                spec.package.clone(),
                "-c".to_string(),
                "android.intent.category.LAUNCHER".to_string(),
                "1".to_string(),
            ];
            self.run_adb_shell("monkey", args).await?;
            format!("Launched package {} via launcher", spec.package)
        };

        self.finish_with_screenshot(
            AndroidActionKind::LaunchApp,
            confirmation,
            spec.wait_or(self.config.launch_settle()),
        )
        .await
    }

    async fn tap(&self, spec: &TapAction) -> Result<AndroidActionOutcome> {
        let (x, y, description) = match &spec.target {
            TapTarget::Coordinates { x, y } => (*x, *y, format!("({x}, {y})")),
            TapTarget::AccessibilityId { value } => {
                let hierarchy = self.dump_ui_hierarchy().await?;
                let (x, y) = locate_accessibility_node(&hierarchy, value)?;
                (x, y, format!("accessibility_id={value}"))
            }
        };

        let args = vec![
            "input".to_string(),
            "tap".to_string(),
            x.to_string(),
            y.to_string(),
        ];
        self.run_adb_shell("input tap", args).await?;

        self.finish_with_screenshot(
            AndroidActionKind::Tap,
            format!("Tapped {description}"),
            spec.wait_or(self.config.tap_settle()),
        )
        .await
    }

    async fn finish_with_screenshot(
        &self,
        kind: AndroidActionKind,
        confirmation: String,
        settle: Duration,
    ) -> Result<AndroidActionOutcome> {
        if !settle.is_zero() {
            sleep(settle).await;
        }
        let screenshot = self.capture_screenshot().await?;
        Ok(AndroidActionOutcome {
            kind,
            confirmation,
            screenshot,
        })
    }

    async fn capture_screenshot(&self) -> Result<ScreenshotArtifact> {
        let args = vec!["screencap".to_string(), "-p".to_string()];
        let output = self.run_adb_exec_out("screencap", args).await?;
        if output.stdout.is_empty() {
            return Err(AndroidExecutorError::EmptyScreenshot);
        }

        fs::create_dir_all(&self.config.artifact_dir).await?;
        let timestamp = Utc::now();
        let filename = format!(
            "{}-{}-{}.png",
            SCREENSHOT_BASENAME,
            timestamp.format("%Y%m%dT%H%M%S"),
            Uuid::new_v4().simple()
        );
        let path = self.config.artifact_dir.join(filename);
        fs::write(&path, &output.stdout).await?;

        Ok(ScreenshotArtifact {
            path: path.to_string_lossy().to_string(),
            captured_at: timestamp,
            content_type: "image/png".to_string(),
        })
    }

    async fn dump_ui_hierarchy(&self) -> Result<String> {
        let args = vec![
            "uiautomator".to_string(),
            "dump".to_string(),
            "/dev/tty".to_string(),
        ];
        let output = self.run_adb_shell("uiautomator dump", args).await?;
        let payload = String::from_utf8(output.stdout).map_err(|err| {
            AndroidExecutorError::CommandOutputUtf8 {
                command: "uiautomator dump".to_string(),
                source: err,
            }
        })?;
        if let Some(idx) = payload.find("<?xml") {
            Ok(payload[idx..].to_string())
        } else {
            Err(AndroidExecutorError::UiHierarchyMissingXml)
        }
    }

    async fn run_adb(&self, label: &str, args: Vec<String>) -> Result<CommandOutput> {
        self.spawn_and_wait(label, args).await
    }

    async fn run_adb_shell(&self, label: &str, shell_args: Vec<String>) -> Result<CommandOutput> {
        let mut args = Vec::with_capacity(shell_args.len() + 3);
        args.push("-s".to_string());
        args.push(self.config.target().to_string());
        args.push("shell".to_string());
        args.extend(shell_args);
        self.spawn_and_wait(label, args).await
    }

    async fn run_adb_exec_out(&self, label: &str, exec_args: Vec<String>) -> Result<CommandOutput> {
        let mut args = Vec::with_capacity(exec_args.len() + 3);
        args.push("-s".to_string());
        args.push(self.config.target().to_string());
        args.push("exec-out".to_string());
        args.extend(exec_args);
        self.spawn_and_wait(label, args).await
    }

    #[allow(clippy::cognitive_complexity)]
    async fn spawn_and_wait(&self, label: &str, args: Vec<String>) -> Result<CommandOutput> {
        let adb_path = self.config.adb_path();
        let command_display = format!("{} {}", adb_path.display(), args.join(" "));
        trace!(command = %command_display, "spawning adb command");

        let output = self
            .run_adb_command(adb_path, args, &command_display)
            .await?;
        self.ensure_success(&command_display, &output)?;

        debug!(command = %command_display, label, "adb command completed");
        Ok(CommandOutput {
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }

    async fn run_adb_command(
        &self,
        adb_path: &Path,
        args: Vec<String>,
        command_display: &str,
    ) -> Result<std::process::Output> {
        let mut command = Command::new(adb_path);
        command.args(&args);
        command.stdin(std::process::Stdio::null());
        command.stdout(std::process::Stdio::piped());
        command.stderr(std::process::Stdio::piped());

        let timeout_duration = self.config.command_timeout();
        let output = timeout(timeout_duration, command.output())
            .await
            .map_err(|_| AndroidExecutorError::AdbCommandTimedOut {
                command: command_display.to_string(),
                timeout_secs: timeout_duration.as_secs(),
            })??;

        Ok(output)
    }

    fn ensure_success(&self, command_display: &str, output: &std::process::Output) -> Result<()> {
        if output.status.success() {
            return Ok(());
        }

        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        warn!(
            command = %command_display,
            status = output.status.code(),
            stderr = %stderr,
            "adb command failed"
        );
        Err(AndroidExecutorError::AdbCommandFailed {
            command: command_display.to_string(),
            status: output.status.code(),
            stderr,
        })
    }
}

#[derive(Clone, Debug)]
struct CommandOutput {
    stdout: Vec<u8>,
    #[allow(dead_code)]
    stderr: Vec<u8>,
}

#[derive(Clone, Debug)]
enum AndroidAction {
    LaunchApp(LaunchApp),
    Tap(TapAction),
}

impl AndroidAction {
    fn kind(&self) -> AndroidActionKind {
        match self {
            AndroidAction::LaunchApp(_) => AndroidActionKind::LaunchApp,
            AndroidAction::Tap(_) => AndroidActionKind::Tap,
        }
    }
}

#[derive(Clone, Debug)]
struct LaunchApp {
    package: String,
    activity: Option<String>,
    wait_ms: Option<u64>,
}

impl LaunchApp {
    fn wait_or(&self, default: Duration) -> Duration {
        self.wait_ms.map(Duration::from_millis).unwrap_or(default)
    }
}

#[derive(Clone, Debug)]
struct TapAction {
    target: TapTarget,
    wait_ms: Option<u64>,
}

impl TapAction {
    fn wait_or(&self, default: Duration) -> Duration {
        self.wait_ms.map(Duration::from_millis).unwrap_or(default)
    }
}

#[derive(Clone, Debug)]
enum TapTarget {
    Coordinates { x: u32, y: u32 },
    AccessibilityId { value: String },
}

fn ensure_android_primitive(action: &ActionPrimitive) -> Result<()> {
    if action.kind != ActionPrimitiveKind::Android {
        return Err(AndroidExecutorError::UnsupportedPrimitive(action.kind));
    }
    Ok(())
}

fn parse_android_action(args: &JsonMap<String, Value>) -> Result<AndroidAction> {
    let operation = get_string(args, "operation")?;
    match operation.as_str() {
        "launch_app" => {
            let package = get_string(args, "package")?;
            let activity = get_optional_string(args, "activity")?;
            let wait_ms = get_optional_u64(args, "wait_ms")?;
            Ok(AndroidAction::LaunchApp(LaunchApp {
                package,
                activity,
                wait_ms,
            }))
        }
        "tap" => {
            let target = parse_tap_target(args)?;
            let wait_ms = get_optional_u64(args, "wait_ms")?;
            Ok(AndroidAction::Tap(TapAction { target, wait_ms }))
        }
        other => Err(AndroidExecutorError::UnsupportedAction(other.to_string())),
    }
}

fn parse_tap_target(args: &JsonMap<String, Value>) -> Result<TapTarget> {
    match (args.get("coordinates"), args.get("accessibility_id")) {
        (Some(coords), None) => parse_coordinates(coords),
        (None, Some(id_value)) => {
            let id = id_value
                .as_str()
                .ok_or_else(|| AndroidExecutorError::InvalidArgumentValue {
                    argument: "accessibility_id",
                    reason: "expected string".to_string(),
                })?
                .trim();
            if id.is_empty() {
                return Err(AndroidExecutorError::InvalidArgumentValue {
                    argument: "accessibility_id",
                    reason: "value cannot be empty".to_string(),
                });
            }
            Ok(TapTarget::AccessibilityId {
                value: id.to_string(),
            })
        }
        (Some(_), Some(_)) => Err(AndroidExecutorError::InvalidArgumentValue {
            argument: "coordinates",
            reason: "specify either coordinates or accessibility_id, not both".to_string(),
        }),
        (None, None) => Err(AndroidExecutorError::InvalidArgumentValue {
            argument: "coordinates",
            reason: "expected 'coordinates' object or 'accessibility_id' string".to_string(),
        }),
    }
}

fn parse_coordinates(value: &Value) -> Result<TapTarget> {
    let obj = value
        .as_object()
        .ok_or_else(|| AndroidExecutorError::InvalidArgumentValue {
            argument: "coordinates",
            reason: "expected object with x/y fields".to_string(),
        })?;
    let x = get_coordinate(obj, "x")?;
    let y = get_coordinate(obj, "y")?;
    Ok(TapTarget::Coordinates { x, y })
}

fn get_coordinate(obj: &JsonMap<String, Value>, key: &'static str) -> Result<u32> {
    let value = obj
        .get(key)
        .ok_or(AndroidExecutorError::MissingArgument(key))?;
    if let Some(number) = value.as_i64() {
        if number < 0 {
            return Err(AndroidExecutorError::InvalidArgumentValue {
                argument: key,
                reason: "coordinate must be non-negative".to_string(),
            });
        }
        if number > u32::MAX as i64 {
            return Err(AndroidExecutorError::InvalidArgumentValue {
                argument: key,
                reason: "coordinate exceeds u32 range".to_string(),
            });
        }
        Ok(number as u32)
    } else {
        Err(AndroidExecutorError::InvalidArgumentValue {
            argument: key,
            reason: "expected integer".to_string(),
        })
    }
}

fn get_string(args: &JsonMap<String, Value>, key: &'static str) -> Result<String> {
    match args.get(key) {
        Some(Value::String(value)) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                Err(AndroidExecutorError::InvalidArgumentValue {
                    argument: key,
                    reason: "value cannot be empty".to_string(),
                })
            } else {
                Ok(trimmed.to_string())
            }
        }
        Some(_) => Err(AndroidExecutorError::InvalidArgumentValue {
            argument: key,
            reason: "expected string".to_string(),
        }),
        None => Err(AndroidExecutorError::MissingArgument(key)),
    }
}

fn get_optional_string(args: &JsonMap<String, Value>, key: &'static str) -> Result<Option<String>> {
    match args.get(key) {
        Some(Value::String(value)) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                Ok(None)
            } else {
                Ok(Some(trimmed.to_string()))
            }
        }
        Some(_) => Err(AndroidExecutorError::InvalidArgumentValue {
            argument: key,
            reason: "expected string".to_string(),
        }),
        None => Ok(None),
    }
}

fn get_optional_u64(args: &JsonMap<String, Value>, key: &'static str) -> Result<Option<u64>> {
    match args.get(key) {
        Some(Value::Number(number)) => number
            .as_u64()
            .ok_or_else(|| AndroidExecutorError::InvalidArgumentValue {
                argument: key,
                reason: "expected non-negative integer".to_string(),
            })
            .map(Some),
        Some(_) => Err(AndroidExecutorError::InvalidArgumentValue {
            argument: key,
            reason: "expected integer".to_string(),
        }),
        None => Ok(None),
    }
}

fn compose_component(package: &str, activity: &str) -> String {
    if activity.contains('/') {
        activity.to_string()
    } else {
        format!("{package}/{activity}")
    }
}

fn locate_accessibility_node(hierarchy: &str, accessibility_id: &str) -> Result<(u32, u32)> {
    use quick_xml::{Reader, events::Event};

    let mut reader = Reader::from_str(hierarchy);
    reader.config_mut().trim_text(true);
    let mut buffer = Vec::new();

    loop {
        match reader.read_event_into(&mut buffer)? {
            Event::Start(ref e) | Event::Empty(ref e) => {
                let mut matches = false;
                let mut bounds_value: Option<String> = None;

                for attr in e.attributes() {
                    let attr = attr?;
                    match attr.key.as_ref() {
                        b"content-desc" => {
                            if attr.unescape_value()?.as_ref() == accessibility_id {
                                matches = true;
                            }
                        }
                        b"bounds" => {
                            let value = attr.unescape_value()?;
                            bounds_value = Some(value.into_owned());
                        }
                        _ => {}
                    }
                }

                if matches {
                    let bounds =
                        bounds_value.ok_or_else(|| AndroidExecutorError::InvalidBounds {
                            value: accessibility_id.to_string(),
                        })?;
                    let (x, y) = parse_bounds(&bounds)?;
                    return Ok((x, y));
                }
            }
            Event::Eof => break,
            _ => {}
        }
        buffer.clear();
    }

    Err(AndroidExecutorError::AccessibilityNodeNotFound {
        accessibility_id: accessibility_id.to_string(),
    })
}

fn parse_bounds(raw: &str) -> Result<(u32, u32)> {
    let cleaned = raw.replace("][", ",");
    let trimmed = cleaned.trim_matches(|ch| ch == '[' || ch == ']');
    let mut values = Vec::with_capacity(4);
    for segment in trimmed.split(',') {
        let value =
            segment
                .trim()
                .parse::<i32>()
                .map_err(|_| AndroidExecutorError::InvalidBounds {
                    value: raw.to_string(),
                })?;
        values.push(value);
    }

    if values.len() != 4 {
        return Err(AndroidExecutorError::InvalidBounds {
            value: raw.to_string(),
        });
    }
    let left = values[0];
    let top = values[1];
    let right = values[2];
    let bottom = values[3];

    if left > right || top > bottom {
        return Err(AndroidExecutorError::InvalidBounds {
            value: raw.to_string(),
        });
    }

    let center_x = left + ((right - left) / 2);
    let center_y = top + ((bottom - top) / 2);

    if center_x < 0 || center_y < 0 {
        return Err(AndroidExecutorError::InvalidBounds {
            value: raw.to_string(),
        });
    }

    Ok((center_x as u32, center_y as u32))
}

/// Produce a sandbox summary for diagnostics endpoints.
pub fn sandbox_summary(config: &AndroidExecutorConfig) -> AndroidSandboxSummary {
    AndroidSandboxSummary {
        target: config.target().to_string(),
        adb_path: config.adb_path().display().to_string(),
        artifact_dir: config.artifact_dir().display().to_string(),
        command_timeout_secs: config.command_timeout().as_secs(),
        launch_settle_ms: config.launch_settle().as_millis() as u64,
        tap_settle_ms: config.tap_settle().as_millis() as u64,
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used, clippy::unwrap_used)]

    use super::*;
    use serde_json::json;

    fn json_object(value: Value) -> JsonMap<String, Value> {
        match value.as_object() {
            Some(map) => map.clone(),
            None => panic!("expected JSON object"),
        }
    }

    #[test]
    fn compose_component_handles_relative_activity() {
        assert_eq!(
            compose_component("com.example.app", ".MainActivity"),
            "com.example.app/.MainActivity"
        );
        assert_eq!(
            compose_component("com.example.app", "com.example.app.MainActivity"),
            "com.example.app/com.example.app.MainActivity"
        );
    }

    #[test]
    fn parse_android_action_launch_app() {
        let args = json_object(json!({
            "operation": "launch_app",
            "package": "com.demo.app",
            "activity": ".Main",
            "wait_ms": 750
        }));

        let action = match parse_android_action(&args) {
            Ok(action) => action,
            Err(err) => panic!("parse launch_app failed: {err}"),
        };
        match action {
            AndroidAction::LaunchApp(spec) => {
                assert_eq!(spec.package, "com.demo.app");
                assert_eq!(spec.activity.as_deref(), Some(".Main"));
                assert_eq!(spec.wait_ms, Some(750));
            }
            _ => panic!("expected launch app"),
        }
    }

    #[test]
    fn parse_android_action_tap_coordinates() {
        let args = json_object(json!({
            "operation": "tap",
            "coordinates": {"x": 120, "y": 640}
        }));

        let action = match parse_android_action(&args) {
            Ok(action) => action,
            Err(err) => panic!("parse tap action failed: {err}"),
        };
        match action {
            AndroidAction::Tap(spec) => match spec.target {
                TapTarget::Coordinates { x, y } => {
                    assert_eq!(x, 120);
                    assert_eq!(y, 640);
                }
                _ => panic!("expected coordinates"),
            },
            _ => panic!("expected tap"),
        }
    }

    #[test]
    fn parse_bounds_returns_center() {
        let (x, y) = match parse_bounds("[0,100][200,300]") {
            Ok(result) => result,
            Err(err) => panic!("parse bounds failed: {err}"),
        };
        assert_eq!(x, 100);
        assert_eq!(y, 200);
    }

    #[test]
    fn locate_accessibility_node_finds_coordinates() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <hierarchy rotation="0">
            <node index="0" text="" resource-id="" class="android.widget.Button"
                package="com.example" content-desc="login" checkable="false"
                checked="false" clickable="true" enabled="true" focusable="true"
                focused="false" scrollable="false" long-clickable="false"
                password="false" selected="false" bounds="[50,400][250,500]" />
        </hierarchy>"#;

        let (x, y) = match locate_accessibility_node(xml, "login") {
            Ok(result) => result,
            Err(err) => panic!("locate node failed: {err}"),
        };
        assert_eq!(x, 150);
        assert_eq!(y, 450);
    }

    #[test]
    fn locate_accessibility_node_errors_when_missing() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <hierarchy rotation="0"></hierarchy>"#;

        let err = locate_accessibility_node(xml, "submit").expect_err("missing node");
        match err {
            AndroidExecutorError::AccessibilityNodeNotFound { accessibility_id } => {
                assert_eq!(accessibility_id, "submit");
            }
            _ => panic!("unexpected error: {err:?}"),
        }
    }
}
