import { Command } from "commander";
import type { CliCommand } from "../cli-command.js";

type SetResult = (command: CliCommand) => void;

function parseProviderModel(
  raw: string | undefined,
  flag: string,
  parseNonEmptyString: (value: string | undefined, label: string) => string,
): string {
  const value = parseNonEmptyString(raw, flag);
  if (!/^[^/\s]+\/.+$/.test(value)) {
    throw new Error(`${flag} must be in provider/model format`);
  }
  return value;
}

export function registerBenchmarkCommand(input: {
  program: Command;
  setResult: SetResult;
  parseNonEmptyString: (raw: string | undefined, flag: string) => string;
  parsePositiveInt: (raw: string | undefined, flag: string) => number;
}): void {
  const benchmarkCommand = input.program.command("benchmark");
  benchmarkCommand
    .command("validate")
    .allowExcessArguments(false)
    .option("--suite <path>")
    .action((options: { suite?: string }) => {
      input.setResult({
        kind: "benchmark_validate",
        suite_path: input.parseNonEmptyString(options.suite, "--suite"),
      });
    });

  benchmarkCommand
    .command("run")
    .allowExcessArguments(false)
    .option("--suite <path>")
    .option("--judge-model <provider/model>")
    .option("--model <provider/model>")
    .option("--scenario <id>")
    .option("--output <dir>")
    .option("--repeat <n>")
    .option("--agent-key <key>")
    .action(
      (options: {
        suite?: string;
        judgeModel?: string;
        model?: string;
        scenario?: string;
        output?: string;
        repeat?: string;
        agentKey?: string;
      }) => {
        input.setResult({
          kind: "benchmark_run",
          suite_path: input.parseNonEmptyString(options.suite, "--suite"),
          judge_model: parseProviderModel(
            options.judgeModel,
            "--judge-model",
            input.parseNonEmptyString,
          ),
          model: options.model
            ? parseProviderModel(options.model, "--model", input.parseNonEmptyString)
            : undefined,
          scenario_id: options.scenario
            ? input.parseNonEmptyString(options.scenario, "--scenario")
            : undefined,
          output_dir: options.output
            ? input.parseNonEmptyString(options.output, "--output")
            : undefined,
          repeat: options.repeat ? input.parsePositiveInt(options.repeat, "--repeat") : undefined,
          agent_key: options.agentKey
            ? input.parseNonEmptyString(options.agentKey, "--agent-key")
            : undefined,
        });
      },
    );
}
