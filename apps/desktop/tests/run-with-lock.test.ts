import { describe, expect, it } from "vitest";
import { runWithLock } from "./integration/run-with-lock.js";

describe("runWithLock", () => {
  it("holds the lock until async work completes", async () => {
    const events: string[] = [];

    await runWithLock(
      () => {
        events.push("acquire");
        return () => {
          events.push("release");
        };
      },
      async () => {
        events.push("start");
        await Promise.resolve();
        events.push("finish");
      },
    );

    expect(events).toEqual(["acquire", "start", "finish", "release"]);
  });

  it("releases the lock when async work throws", async () => {
    const events: string[] = [];

    await expect(
      runWithLock(
        () => {
          events.push("acquire");
          return () => {
            events.push("release");
          };
        },
        async () => {
          events.push("start");
          throw new Error("boom");
        },
      ),
    ).rejects.toThrow("boom");

    expect(events).toEqual(["acquire", "start", "release"]);
  });
});
