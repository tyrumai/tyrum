import { describe } from "vitest";
import { registerMemoryV1DalCrudTests } from "./memory-v1-dal.crud-test-support.js";
import { registerMemoryV1DalSearchTests } from "./memory-v1-dal.search-test-support.js";
import { memoryV1DalFixtures } from "./memory-v1-dal.test-support.js";

for (const fixture of memoryV1DalFixtures) {
  describe(`MemoryV1Dal (${fixture.name})`, () => {
    registerMemoryV1DalCrudTests(fixture);
    registerMemoryV1DalSearchTests(fixture);
  });
}
