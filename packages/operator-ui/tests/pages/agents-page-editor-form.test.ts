import { describe, expect, it } from "vitest";
import {
  buildPayload,
  createBlankForm,
} from "../../src/components/pages/agents-page-editor-form.js";

describe("agents-page-editor-form", () => {
  it("rejects empty agent keys when building a create payload", () => {
    const form = createBlankForm();

    expect(() => buildPayload(form)).toThrowError("Agent key is required.");
  });
});
