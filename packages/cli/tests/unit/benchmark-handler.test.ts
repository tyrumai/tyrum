import { afterEach, describe, expect, it, vi } from "vitest";

const { loadBenchmarkSuiteFromFileMock, runBenchmarkSuiteMock } = vi.hoisted(() => ({
  loadBenchmarkSuiteFromFileMock: vi.fn(),
  runBenchmarkSuiteMock: vi.fn(),
}));

vi.mock("../../src/benchmark/load-suite.js", () => ({
  loadBenchmarkSuiteFromFile: loadBenchmarkSuiteFromFileMock,
}));

vi.mock("../../src/benchmark/runner.js", () => ({
  runBenchmarkSuite: runBenchmarkSuiteMock,
}));

import { handleBenchmarkRun, handleBenchmarkValidate } from "../../src/handlers/benchmark.js";

describe("benchmark handlers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    loadBenchmarkSuiteFromFileMock.mockReset();
    runBenchmarkSuiteMock.mockReset();
  });

  it("prints benchmark suite metadata when validation succeeds", async () => {
    loadBenchmarkSuiteFromFileMock.mockResolvedValue({
      path: "/tmp/suite.yaml",
      suite: {
        suite_id: "core-live-v1",
        title: "Core Live Benchmarks",
        fixtures: [{ id: "desktop" }],
        scenarios: [{ id: "weather" }, { id: "pizza" }],
      },
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const exitCode = await handleBenchmarkValidate({
      kind: "benchmark_validate",
      suite_path: "/tmp/suite.yaml",
    });

    expect(exitCode).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify(
        {
          status: "ok",
          path: "/tmp/suite.yaml",
          suite_id: "core-live-v1",
          title: "Core Live Benchmarks",
          fixture_count: 1,
          scenario_ids: ["weather", "pizza"],
        },
        null,
        2,
      ),
    );
  });

  it("returns a non-zero exit code when validation fails", async () => {
    loadBenchmarkSuiteFromFileMock.mockRejectedValue(new Error("invalid suite"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const exitCode = await handleBenchmarkValidate({
      kind: "benchmark_validate",
      suite_path: "/tmp/broken.yaml",
    });

    expect(exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith("benchmark validate: failed: invalid suite");
  });

  it("runs a benchmark suite and returns zero only when the suite passes", async () => {
    runBenchmarkSuiteMock.mockResolvedValue({
      suite_id: "core-live-v1",
      status: "passed",
      scenario_runs: [],
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const exitCode = await handleBenchmarkRun(
      {
        kind: "benchmark_run",
        suite_path: "/tmp/suite.yaml",
        judge_model: "openai/gpt-5.4-mini",
        model: "openai/gpt-5.4",
        scenario_id: "weather",
        output_dir: "/tmp/out",
        repeat: 2,
        agent_key: "custom-agent",
      },
      "/tmp/home",
    );

    expect(exitCode).toBe(0);
    expect(runBenchmarkSuiteMock).toHaveBeenCalledWith("/tmp/home", {
      suite_path: "/tmp/suite.yaml",
      judge_model: { model: "openai/gpt-5.4-mini" },
      model: { model: "openai/gpt-5.4" },
      scenario_id: "weather",
      output_dir: "/tmp/out",
      repeat: 2,
      agent_key: "custom-agent",
    });
    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify(
        {
          suite_id: "core-live-v1",
          status: "passed",
          scenario_runs: [],
        },
        null,
        2,
      ),
    );
  });

  it("returns one for failed suites and benchmark execution errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    runBenchmarkSuiteMock.mockResolvedValueOnce({
      suite_id: "core-live-v1",
      status: "failed",
      scenario_runs: [],
    });

    const failedExitCode = await handleBenchmarkRun(
      {
        kind: "benchmark_run",
        suite_path: "/tmp/suite.yaml",
        judge_model: "openai/gpt-5.4-mini",
      },
      "/tmp/home",
    );

    expect(failedExitCode).toBe(1);

    runBenchmarkSuiteMock.mockRejectedValueOnce(new Error("gateway unavailable"));

    const errorExitCode = await handleBenchmarkRun(
      {
        kind: "benchmark_run",
        suite_path: "/tmp/suite.yaml",
        judge_model: "openai/gpt-5.4-mini",
      },
      "/tmp/home",
    );

    expect(errorExitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith("benchmark run: failed: gateway unavailable");
  });
});
