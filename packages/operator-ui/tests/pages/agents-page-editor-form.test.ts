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

  it("persists a blank primary model as null", () => {
    const form = createBlankForm();
    form.agentKey = "agent-null-model";
    form.model = "";
    form.variant = "ignored";
    form.fallbacks = "openai/gpt-4.1";

    const payload = buildPayload(form);
    expect(payload.config.model).toEqual({ model: null });
  });
});
