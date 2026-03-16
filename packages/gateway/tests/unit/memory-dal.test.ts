import { describe } from "vitest";
import { registerMemoryDalCrudTests } from "./memory-dal.crud-test-support.js";
import { registerMemoryDalSearchTests } from "./memory-dal.search-test-support.js";
import { memoryDalFixtures } from "./memory-dal.test-support.js";

for (const fixture of memoryDalFixtures) {
  describe(`MemoryDal (${fixture.name})`, () => {
    registerMemoryDalCrudTests(fixture);
    registerMemoryDalSearchTests(fixture);
  });
}
