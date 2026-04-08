import { BenchmarkRunRequest, type LiveBenchmarkScenarioSpec } from "@tyrum/contracts";
import type { CliCommand } from "../cli-command.js";
import { loadBenchmarkSuiteFromFile } from "../benchmark/load-suite.js";
import { runBenchmarkSuite } from "../benchmark/runner.js";

export async function handleBenchmarkValidate(
  command: Extract<CliCommand, { kind: "benchmark_validate" }>,
): Promise<number> {
  try {
    const loaded = await loadBenchmarkSuiteFromFile(command.suite_path);
    console.log(
      JSON.stringify(
        {
          status: "ok",
          path: loaded.path,
          suite_id: loaded.suite.suite_id,
          title: loaded.suite.title,
          fixture_count: loaded.suite.fixtures.length,
          scenario_ids: loaded.suite.scenarios.map(
            (scenario: LiveBenchmarkScenarioSpec) => scenario.id,
          ),
        },
        null,
        2,
      ),
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`benchmark validate: failed: ${message}`);
    return 1;
  }
}

export async function handleBenchmarkRun(
  command: Extract<CliCommand, { kind: "benchmark_run" }>,
  home: string,
): Promise<number> {
  try {
    const report = await runBenchmarkSuite(
      home,
      BenchmarkRunRequest.parse({
        suite_path: command.suite_path,
        judge_model: { model: command.judge_model },
        model: command.model ? { model: command.model } : undefined,
        scenario_id: command.scenario_id,
        output_dir: command.output_dir,
        repeat: command.repeat,
        agent_key: command.agent_key,
      }),
    );
    console.log(JSON.stringify(report, null, 2));
    return report.status === "passed" ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`benchmark run: failed: ${message}`);
    return 1;
  }
}
