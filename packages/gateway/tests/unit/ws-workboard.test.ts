import { describe } from "vitest";
import { registerWorkboardCrudTests } from "./ws-workboard.crud-test-support.js";
import { registerWorkboardTransitionTests } from "./ws-workboard.transitions-test-support.js";
import { registerWorkboardTransitionErrorTests } from "./ws-workboard.transition-errors-test-support.js";
import { registerWorkboardWipArtifactTests } from "./ws-workboard.wip-artifacts-test-support.js";
import { registerWorkboardEntityTests } from "./ws-workboard.entities-test-support.js";
import { registerWorkboardErrorHandlingTests } from "./ws-workboard.error-handling-test-support.js";
import { registerWorkboardScopeErrorTests } from "./ws-workboard.scopes-errors-test-support.js";
import { registerWorkboardScopeNonCreationTests } from "./ws-workboard.scope-noncreation-test-support.js";

describe("handleClientMessage (work.*)", () => {
  registerWorkboardCrudTests();
  registerWorkboardTransitionTests();
  registerWorkboardTransitionErrorTests();
  registerWorkboardWipArtifactTests();
  registerWorkboardEntityTests();
  registerWorkboardErrorHandlingTests();
  registerWorkboardScopeErrorTests();
  registerWorkboardScopeNonCreationTests();
});
