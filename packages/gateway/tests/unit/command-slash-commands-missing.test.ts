import { afterEach, describe } from "vitest";
import { createSlashCommandFixture } from "./command-slash-commands-missing.test-support.js";
import { registerCommandsTests } from "./command-slash-commands-missing.commands-test-support.js";
import { registerModelTests } from "./command-slash-commands-missing.model-test-support.js";
import { registerSendTests } from "./command-slash-commands-missing.send-test-support.js";

describe("missing slash commands", () => {
  const fixture = createSlashCommandFixture();

  afterEach(async () => {
    const db = fixture.db();
    if (db) {
      await db.close();
      fixture.setDb(undefined);
    }
  });

  registerCommandsTests(fixture);
  registerModelTests(fixture);
  registerSendTests(fixture);
});
