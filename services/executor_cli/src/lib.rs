//! Sandboxed CLI executor implementation for Tyrum.

use std::{
    env, fs,
    path::{Path, PathBuf},
    process::ExitStatus,
};

use nix::unistd::Uid;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;
use tokio::process::Command;
use tracing::warn;
use tyrum_shared::planner::{ActionArguments, ActionPrimitive, ActionPrimitiveKind};

pub mod telemetry;

const SANDBOX_ROOT_ENV: &str = "CLI_EXECUTOR_SANDBOX_DIR";

/// Result type alias for CLI executor operations.
pub type Result<T> = std::result::Result<T, CliExecutorError>;

/// Execution status for a CLI command.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CliExecutionStatus {
    /// Command completed with exit code 0.
    Success,
    /// Command completed with a non-zero exit code.
    Failure,
}

/// Structured outcome returned to the planner after a CLI action.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CliActionOutcome {
    /// Indicates whether the command reported success or failure.
    pub status: CliExecutionStatus,
    /// Exit code reported by the command (negative values indicate signals on Unix).
    pub exit_code: i32,
    /// Captured standard output as UTF-8 (lossy conversion).
    pub stdout: String,
    /// Captured standard error as UTF-8 (lossy conversion).
    pub stderr: String,
}

/// Summary of the CLI sandbox configuration exported for diagnostics.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SandboxSummary {
    /// Canonical sandbox root path, if configured.
    pub sandbox_root: Option<String>,
    /// Signals that outbound network access is disabled for the sandbox.
    pub network_access: bool,
    /// Indicates whether the process is running as a non-root user.
    pub runs_as_non_root: bool,
}

/// Errors surfaced by the CLI executor.
#[allow(clippy::exhaustive_enums)]
#[derive(Debug, Error)]
pub enum CliExecutorError {
    /// Planner requested an unsupported primitive kind.
    #[error("unsupported primitive kind {0:?}")]
    UnsupportedPrimitive(ActionPrimitiveKind),
    /// Planner omitted a mandatory argument.
    #[error("missing required argument '{0}'")]
    MissingArgument(&'static str),
    /// Planner supplied an argument of the wrong type or shape.
    #[error("invalid argument '{argument}': {reason}")]
    InvalidArgumentValue {
        /// Argument name that failed validation.
        argument: &'static str,
        /// Human-readable reason for the failure.
        reason: &'static str,
    },
    /// Sandbox root environment variable was not configured.
    #[error("sandbox root not configured; set {SANDBOX_ROOT_ENV}")]
    SandboxNotConfigured,
    /// Sandbox root path does not exist or is not a directory.
    #[error("sandbox root '{0}' does not exist or is not a directory")]
    SandboxInvalid(String),
    /// Requested working directory does not exist inside the sandbox.
    #[error("working directory '{requested}' not found within sandbox")]
    WorkingDirectoryNotFound {
        /// Original working directory request.
        requested: String,
    },
    /// Requested working directory escapes the sandbox boundary.
    #[error("working directory '{requested}' escapes sandbox")]
    WorkingDirectoryEscapesSandbox {
        /// Original working directory request.
        requested: String,
    },
    /// Requested command path escapes the sandbox root.
    #[error("command '{command}' escapes sandbox")]
    CommandEscapesSandbox {
        /// Original command string supplied by the planner.
        command: String,
    },
    /// Requested command path could not be resolved.
    #[error("command '{command}' not found within sandbox")]
    CommandNotFound {
        /// Original command string supplied by the planner.
        command: String,
    },
    /// Executor detected it is running as root, which violates sandbox policy.
    #[error("cli executor must run as a non-root user")]
    RootUserNotAllowed,
    /// IO failure while spawning or awaiting the command process.
    #[error("command execution failed: {0}")]
    CommandIo(#[from] std::io::Error),
}

#[derive(Clone, Debug)]
struct CliActionArgs {
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
}

#[derive(Clone, Debug)]
enum CommandTarget {
    Bare(String),
    Resolved(PathBuf),
}

impl CommandTarget {
    fn display(&self) -> String {
        match self {
            Self::Bare(program) => program.clone(),
            Self::Resolved(path) => path.display().to_string(),
        }
    }

    fn telemetry_name(&self) -> String {
        match self {
            Self::Bare(program) => program.clone(),
            Self::Resolved(path) => path
                .file_name()
                .and_then(|value| value.to_str())
                .map_or_else(|| path.display().to_string(), |value| value.to_string()),
        }
    }
}

/// Execute a CLI primitive and capture its stdout/stderr + exit code.
pub async fn execute_cli_action(action: &ActionPrimitive) -> Result<CliActionOutcome> {
    let sandbox = sandbox_root()?;
    execute_cli_action_in_sandbox(action, &sandbox).await
}

async fn execute_cli_action_in_sandbox(
    action: &ActionPrimitive,
    sandbox: &Path,
) -> Result<CliActionOutcome> {
    ensure_cli_primitive(action)?;
    ensure_non_root()?;

    let args = parse_cli_args(&action.args)?;
    let working_dir = resolve_working_directory(sandbox, args.cwd.as_deref())?;
    let command_target = resolve_executable(&args.command, &working_dir, sandbox)?;

    let command_display = command_target.display();
    let telemetry_name = command_target.telemetry_name();
    let arguments = args.args.clone();
    let working_dir_for_spawn = working_dir.clone();
    let command_for_spawn = command_target.clone();

    let context = telemetry::AttemptContext::new(&telemetry_name, &working_dir);

    let (result, _) = telemetry::record_attempt(&context, async move {
        let mut command = match command_for_spawn {
            CommandTarget::Bare(program) => Command::new(program),
            CommandTarget::Resolved(path) => Command::new(path),
        };

        command.current_dir(&working_dir_for_spawn);

        if !arguments.is_empty() {
            command.args(&arguments);
        }

        let output = command
            .output()
            .await
            .map_err(CliExecutorError::CommandIo)?;
        let exit_code = exit_code(&output.status);
        let status = if exit_code == 0 {
            CliExecutionStatus::Success
        } else {
            CliExecutionStatus::Failure
        };

        Ok(CliActionOutcome {
            status,
            exit_code,
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    })
    .await;

    result.map_err(|error| {
        warn!(command = %command_display, error = %error, "cli action failed");
        error
    })
}

/// Expose the current sandbox configuration for debugging endpoints.
pub fn sandbox_summary() -> SandboxSummary {
    SandboxSummary {
        sandbox_root: sandbox_root().ok().map(|path| path.display().to_string()),
        network_access: false,
        runs_as_non_root: !Uid::effective().is_root(),
    }
}

fn ensure_cli_primitive(action: &ActionPrimitive) -> Result<()> {
    if action.kind != ActionPrimitiveKind::Cli {
        return Err(CliExecutorError::UnsupportedPrimitive(action.kind));
    }
    Ok(())
}

fn ensure_non_root() -> Result<()> {
    if Uid::effective().is_root() {
        return Err(CliExecutorError::RootUserNotAllowed);
    }
    Ok(())
}

fn parse_cli_args(args: &ActionArguments) -> Result<CliActionArgs> {
    let command = args
        .get("command")
        .ok_or(CliExecutorError::MissingArgument("command"))?
        .as_str()
        .ok_or(CliExecutorError::InvalidArgumentValue {
            argument: "command",
            reason: "expected string",
        })?
        .trim()
        .to_string();

    if command.is_empty() {
        return Err(CliExecutorError::InvalidArgumentValue {
            argument: "command",
            reason: "must not be empty",
        });
    }

    let arguments = match args.get("args") {
        Some(Value::Array(items)) => {
            let mut parsed = Vec::with_capacity(items.len());
            for value in items {
                let element = value
                    .as_str()
                    .ok_or(CliExecutorError::InvalidArgumentValue {
                        argument: "args",
                        reason: "expected string elements",
                    })?;
                parsed.push(element.to_string());
            }
            parsed
        }
        Some(_) => {
            return Err(CliExecutorError::InvalidArgumentValue {
                argument: "args",
                reason: "expected array of strings",
            });
        }
        None => Vec::new(),
    };

    let cwd = match args.get("cwd") {
        Some(value) => {
            let value = value
                .as_str()
                .ok_or(CliExecutorError::InvalidArgumentValue {
                    argument: "cwd",
                    reason: "expected string",
                })?;
            if value.trim().is_empty() {
                None
            } else {
                Some(value.to_string())
            }
        }
        None => None,
    };

    Ok(CliActionArgs {
        command,
        args: arguments,
        cwd,
    })
}

fn sandbox_root() -> Result<PathBuf> {
    let raw = env::var(SANDBOX_ROOT_ENV).map_err(|_| CliExecutorError::SandboxNotConfigured)?;
    let path = PathBuf::from(&raw);
    let metadata =
        fs::metadata(&path).map_err(|_| CliExecutorError::SandboxInvalid(raw.clone()))?;
    if !metadata.is_dir() {
        return Err(CliExecutorError::SandboxInvalid(raw));
    }
    fs::canonicalize(&path).map_err(|_| CliExecutorError::SandboxInvalid(raw))
}

fn resolve_working_directory(sandbox: &Path, requested: Option<&str>) -> Result<PathBuf> {
    match requested {
        None => Ok(sandbox.to_path_buf()),
        Some(value) => {
            let requested_path = Path::new(value);
            let candidate = if requested_path.is_absolute() {
                requested_path.to_path_buf()
            } else {
                sandbox.join(requested_path)
            };

            let metadata = fs::metadata(&candidate).map_err(|_| {
                CliExecutorError::WorkingDirectoryNotFound {
                    requested: value.to_string(),
                }
            })?;
            if !metadata.is_dir() {
                return Err(CliExecutorError::WorkingDirectoryNotFound {
                    requested: value.to_string(),
                });
            }

            let canonical = fs::canonicalize(&candidate).map_err(|_| {
                CliExecutorError::WorkingDirectoryNotFound {
                    requested: value.to_string(),
                }
            })?;

            if !canonical.starts_with(sandbox) {
                return Err(CliExecutorError::WorkingDirectoryEscapesSandbox {
                    requested: value.to_string(),
                });
            }

            Ok(canonical)
        }
    }
}

fn resolve_executable(command: &str, cwd: &Path, sandbox: &Path) -> Result<CommandTarget> {
    if is_bare_command(command) {
        return Ok(CommandTarget::Bare(command.to_string()));
    }

    let requested_path = Path::new(command);
    let candidate = if requested_path.is_absolute() {
        requested_path.to_path_buf()
    } else {
        cwd.join(requested_path)
    };

    let canonical =
        fs::canonicalize(&candidate).map_err(|_| CliExecutorError::CommandNotFound {
            command: command.to_string(),
        })?;

    if !canonical.starts_with(sandbox) {
        return Err(CliExecutorError::CommandEscapesSandbox {
            command: command.to_string(),
        });
    }

    Ok(CommandTarget::Resolved(canonical))
}

fn is_bare_command(command: &str) -> bool {
    use std::path::Component;

    let mut components = Path::new(command).components();
    matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none()
}

fn exit_code(status: &ExitStatus) -> i32 {
    status.code().unwrap_or_else(|| {
        #[cfg(unix)]
        {
            use std::os::unix::process::ExitStatusExt;
            status.signal().map_or(-1, |signal| -signal)
        }

        #[cfg(not(unix))]
        {
            -1
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    use tempfile::TempDir;

    fn into_args(value: Value) -> ActionArguments {
        value
            .as_object()
            .expect("primitive args must be object")
            .clone()
    }

    #[test]
    fn bare_command_detection() {
        assert!(is_bare_command("echo"));
        assert!(is_bare_command("false"));
        assert!(!is_bare_command("./script.sh"));
        assert!(!is_bare_command("/bin/ls"));
        assert!(!is_bare_command("../escape"));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn command_success_captures_output() -> anyhow::Result<()> {
        let sandbox = TempDir::new()?;

        let primitive = ActionPrimitive::new(
            ActionPrimitiveKind::Cli,
            into_args(json!({
                "command": "echo",
                "args": ["hello", "tyrum"]
            })),
        );

        let outcome = super::execute_cli_action_in_sandbox(&primitive, sandbox.path()).await?;

        assert_eq!(outcome.status, CliExecutionStatus::Success);
        assert_eq!(outcome.exit_code, 0);
        assert!(outcome.stdout.contains("hello tyrum"));
        assert!(outcome.stderr.is_empty());

        Ok(())
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn command_failure_reports_exit_code() -> anyhow::Result<()> {
        let sandbox = TempDir::new()?;

        let primitive = ActionPrimitive::new(
            ActionPrimitiveKind::Cli,
            into_args(json!({
                "command": "false"
            })),
        );

        let outcome = super::execute_cli_action_in_sandbox(&primitive, sandbox.path()).await?;

        assert_eq!(outcome.status, CliExecutionStatus::Failure);
        assert_ne!(outcome.exit_code, 0);

        Ok(())
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn rejects_working_directory_escape() -> anyhow::Result<()> {
        let sandbox = TempDir::new()?;

        // Ensure a sibling directory exists so canonicalisation succeeds outside the sandbox.
        let outside = sandbox
            .path()
            .parent()
            .map(|parent| parent.join("outside"))
            .expect("sandbox path has parent");
        std::fs::create_dir_all(&outside)?;

        let primitive = ActionPrimitive::new(
            ActionPrimitiveKind::Cli,
            into_args(json!({
                "command": "echo",
                "cwd": "../outside",
                "args": ["noop"]
            })),
        );

        let err = super::execute_cli_action_in_sandbox(&primitive, sandbox.path())
            .await
            .expect_err("directory traversal should be blocked");

        match err {
            CliExecutorError::WorkingDirectoryEscapesSandbox { .. } => {}
            other => panic!("unexpected error: {other:?}"),
        }

        Ok(())
    }
}
