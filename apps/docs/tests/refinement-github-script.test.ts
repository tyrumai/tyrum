import { describe, expect, it } from "vitest";
import {
  parseArgs,
  setup,
  createSweep,
  doctor,
  nextVantageFromSweeps,
  recordSweepInHubBody,
  REFINEMENT_PROJECT_TITLE,
  syncThreadMap,
} from "../../../scripts/refinement-github.mjs";

describe("refinement GitHub script", () => {
  it("defaults commands to dry-run mode", () => {
    expect(parseArgs(["setup"])).toMatchObject({
      command: "setup",
      apply: false,
      repo: "tyrumai/tyrum",
    });
  });

  it("plans setup without running GitHub commands in dry-run mode", async () => {
    const runner = async (): Promise<never> => {
      throw new Error("runner should not be called during setup dry-run");
    };

    const plan = await setup(parseArgs(["setup"]), runner);

    expect(plan).toMatchObject({
      command: "setup",
      mode: "dry-run",
    });
    expect(plan.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Create label: product-refinement" }),
        expect.objectContaining({
          title: `Create project if missing: ${REFINEMENT_PROJECT_TITLE}`,
        }),
        expect.objectContaining({ title: "Create project field: Vantage" }),
        expect.objectContaining({ title: "Create hub issue if missing" }),
      ]),
    );
  });

  it("plans doctor checks without running GitHub commands in dry-run mode", async () => {
    const runner = async (): Promise<never> => {
      throw new Error("runner should not be called during doctor dry-run");
    };

    const plan = await doctor(parseArgs(["doctor"]), runner);

    expect(plan.operations.map((operation) => operation.title)).toEqual([
      "Check GitHub CLI version",
      "Check GitHub auth",
      "Check repository access",
      "Check GitHub Project support",
      "Check refinement labels",
      "Check refinement issues",
    ]);
  });

  it("rotates daily sweeps through the configured vantage list", () => {
    expect(nextVantageFromSweeps([])).toBe("Architecture");
    expect(
      nextVantageFromSweeps([
        {
          title: "[Daily Sweep] 2026-07-02 - Architecture",
        },
      ]),
    ).toBe("UX/UI");
  });

  it.each(["open", "closed"])("reuses a %s same-date daily sweep", async (state) => {
    const date = new Date().toISOString().slice(0, 10);
    const sweep = {
      number: state === "open" ? 123 : 124,
      title: `[Daily Sweep] ${date} - Architecture`,
      url: `https://github.com/tyrumai/tyrum/issues/${state === "open" ? 123 : 124}`,
    };
    const commands: Array<{ args: string[] }> = [];
    const runner = async (command: { args: string[] }) => {
      commands.push(command);
      if (command.args.includes("refinement-hub")) {
        return {
          stdout: JSON.stringify([
            {
              number: 100,
              title: "[Refinement Hub] Tyrum Product Refinement",
              body: `## Active Daily Sweeps\n\n- #${sweep.number} - ${sweep.title}\n`,
            },
          ]),
          stderr: "",
        };
      }
      if (command.args.includes("daily-sweep")) {
        const stateIndex = command.args.indexOf("--state");
        const requestedState = command.args[stateIndex + 1];
        return {
          stdout: JSON.stringify(state === "open" || requestedState === "all" ? [sweep] : []),
          stderr: "",
        };
      }
      throw new Error(`Unexpected command: ${command.args.join(" ")}`);
    };

    const result = await createSweep(
      parseArgs(["create-sweep", "--apply", "--vantage", "Architecture"]),
      runner,
    );

    expect(result.issue).toEqual(sweep);
    expect(commands.find((command) => command.args.includes("daily-sweep"))?.args).toEqual(
      expect.arrayContaining(["--state", "all"]),
    );
    expect(
      commands.some((command) => command.args[0] === "issue" && command.args[1] === "create"),
    ).toBe(false);
  });

  it("separates a new sweep from an existing hub-list entry", () => {
    const hubBody =
      "# Refinement Hub\n\n## Active Daily Sweeps\n\n- #2116 - [Daily Sweep] 2026-07-02 - Architecture\n";

    expect(
      recordSweepInHubBody(hubBody, {
        number: 2130,
        title: "[Daily Sweep] 2026-07-16 - UX/UI",
      }),
    ).toBe(
      "# Refinement Hub\n\n## Active Daily Sweeps\n\n- #2130 - [Daily Sweep] 2026-07-16 - UX/UI\n- #2116 - [Daily Sweep] 2026-07-02 - Architecture\n",
    );
  });

  it("plans daily sweep and thread sync without live mutations", async () => {
    const runner = async (): Promise<never> => {
      throw new Error("runner should not be called during dry-runs");
    };

    const sweepPlan = await createSweep(
      parseArgs(["create-sweep", "--vantage", "Architecture"]),
      runner,
    );
    const syncPlan = await syncThreadMap(
      parseArgs([
        "sync-thread-map",
        "--issue",
        "123",
        "--parent-issue",
        "100",
        "--root-issue",
        "100",
        "--thread-id",
        "thread_abc",
        "--thread-url",
        "https://codex.example/thread_abc",
        "--spawned-from-thread-id",
        "thread_parent",
      ]),
      runner,
    );

    expect(sweepPlan.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: expect.stringContaining("[Daily Sweep]"),
        }),
      ]),
    );
    expect(syncPlan.operations.map((operation) => operation.title)).toEqual([
      "Fetch issue #123",
      "Update codex-thread-map for issue #123",
    ]);
  });
});
