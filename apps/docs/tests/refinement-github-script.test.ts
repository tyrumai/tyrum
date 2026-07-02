import { describe, expect, it } from "vitest";
import {
  parseArgs,
  setup,
  createSweep,
  doctor,
  nextVantageFromSweeps,
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
