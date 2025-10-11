use std::{
    fs::File,
    io::Write,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, anyhow, bail};
use clap::Parser;
use serde_json::to_string_pretty;
use tracing::{info, warn};
use tracing_subscriber::{EnvFilter, fmt};
use uuid::Uuid;

use tyrum_memory::MemoryDal;
use tyrum_planner::{
    EventLog, EventLogSettings,
    replay::{ReplayMetrics, ReplayReport, ReplaySandbox},
};

/// CLI surface for the replay sandbox binary.
#[derive(Debug, Parser)]
#[command(
    name = "replay_sandbox",
    about = "Replay stored planner traces against stub executors to detect capability drift."
)]
struct Args {
    /// Planner plan identifier to replay.
    #[arg(long)]
    plan_id: Uuid,

    /// Postgres URL hosting the planner event log.
    #[arg(long, env = "PLANNER_EVENT_LOG_URL")]
    database_url: String,

    /// Subject identifier used to hydrate Tyrum memory artifacts (optional).
    #[arg(long, env = "REPLAY_SUBJECT_ID")]
    subject_id: Option<Uuid>,

    /// Directory for drift artifacts on replay failure.
    #[arg(long, default_value = "artifacts/replay")]
    output_dir: PathBuf,
}

#[tokio::main(flavor = "multi_thread")]
async fn main() -> Result<()> {
    init_tracing()?;
    let args = Args::parse();

    let event_log = EventLog::connect(EventLogSettings::new(&args.database_url))
        .await
        .context("connect planner event log")?;
    let memory = MemoryDal::new(event_log.pool().clone());

    let sandbox = ReplaySandbox::new(event_log, memory, ReplayMetrics::global());
    let report = sandbox
        .replay_plan(args.plan_id, args.subject_id)
        .await
        .context("replay plan trace")?;

    if report.succeeded() {
        info!(
            plan_id = %args.plan_id,
            steps = report.steps_replayed,
            "replay completed successfully"
        );
        return Ok(());
    }

    let artifact =
        write_diff_markdown(&report, &args.output_dir).context("write replay diff artifact")?;
    warn!(
        plan_id = %args.plan_id,
        steps = report.steps_replayed,
        mismatches = report.mismatches.len(),
        artifact = %artifact.display(),
        "replay detected drift"
    );
    bail!(
        "detected drift while replaying plan {} — see {}",
        args.plan_id,
        artifact.display()
    );
}

fn init_tracing() -> Result<()> {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,tyrum_planner=info,replay_sandbox=info"));

    fmt()
        .with_env_filter(filter)
        .with_target(false)
        .compact()
        .try_init()
        .map_err(|err| anyhow!("install tracing subscriber: {err}"))?;
    Ok(())
}

fn write_diff_markdown(report: &ReplayReport, output_dir: &Path) -> Result<PathBuf> {
    std::fs::create_dir_all(output_dir)
        .with_context(|| format!("create replay artifact directory {}", output_dir.display()))?;

    let file_path = output_dir.join(format!("{}.md", report.plan_id));
    let mut file = File::create(&file_path)
        .with_context(|| format!("create replay artifact {}", file_path.display()))?;

    writeln!(file, "# Planner Replay Drift")?;
    writeln!(file)?;
    writeln!(file, "- Plan ID: {}", report.plan_id)?;
    writeln!(file, "- Steps replayed: {}", report.steps_replayed)?;
    writeln!(file, "- Mismatches: {}", report.mismatches.len())?;
    writeln!(file)?;

    for mismatch in &report.mismatches {
        writeln!(
            file,
            "## Step {} – {:?}",
            mismatch.step_index, mismatch.primitive.kind
        )?;
        writeln!(file, "- Expected executor: {}", mismatch.expected_executor)?;
        writeln!(file, "- Actual executor: {}", mismatch.actual_executor)?;
        writeln!(file)?;

        writeln!(file, "### Primitive")?;
        writeln!(
            file,
            "```json\n{}\n```",
            to_string_pretty(&mismatch.primitive)
                .unwrap_or_else(|_| "<primitive serialization failed>".into())
        )?;

        writeln!(file, "### Expected Result")?;
        writeln!(
            file,
            "```json\n{}\n```",
            to_string_pretty(&mismatch.expected_result)
                .unwrap_or_else(|_| "<expected serialization failed>".into())
        )?;

        writeln!(file, "### Actual Result")?;
        writeln!(
            file,
            "```json\n{}\n```",
            to_string_pretty(&mismatch.actual_result)
                .unwrap_or_else(|_| "<actual serialization failed>".into())
        )?;

        if mismatch.diffs.is_empty() {
            writeln!(file, "_No structured diffs available._")?;
        } else {
            writeln!(file, "### Differences")?;
            for diff in &mismatch.diffs {
                let expected = to_string_pretty(&diff.expected)
                    .unwrap_or_else(|_| "<expected serialization failed>".into());
                let actual = to_string_pretty(&diff.actual)
                    .unwrap_or_else(|_| "<actual serialization failed>".into());
                let path = if diff.path.is_empty() {
                    "/"
                } else {
                    diff.path.as_str()
                };
                writeln!(file, "- `{path}`: expected `{expected}` got `{actual}`")?;
            }
        }

        writeln!(file)?;
    }

    if report.mismatches.is_empty() {
        writeln!(
            file,
            "_Replay succeeded; no drift detected for plan {}._",
            report.plan_id
        )?;
    }

    Ok(file_path)
}
