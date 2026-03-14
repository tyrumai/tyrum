import { afterEach, describe } from "vitest";
import { createWorkboardDalFixture } from "./workboard-dal.test-support.js";
import { registerItemsTests } from "./workboard-dal.items-test-support.js";
import { registerTransitionGuardTests } from "./workboard-dal.transition-guards-test-support.js";
import { registerStateTests } from "./workboard-dal.state-test-support.js";
import { registerTasksTests } from "./workboard-dal.tasks-test-support.js";
import { registerLeasesTests } from "./workboard-dal.leases-test-support.js";

describe("WorkboardDal", () => {
  const fixture = createWorkboardDalFixture();

  afterEach(async () => {
    const db = fixture.db();
    if (db) {
      await db.close();
      fixture.setDb(undefined);
    }
  });

  registerItemsTests(fixture);
  registerTransitionGuardTests(fixture);
  registerStateTests(fixture);
  registerTasksTests(fixture);
  registerLeasesTests(fixture);
});
