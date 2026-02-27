import { describe, expect, it } from "vitest";
import { OPERATOR_UI_CSS } from "../src/style.js";

describe("OPERATOR_UI_CSS", () => {
  it("does not include obsolete legacy layout rules", () => {
    expect(OPERATOR_UI_CSS).not.toContain(".tyrum-operator-ui .layout");
    expect(OPERATOR_UI_CSS).not.toContain(".tyrum-operator-ui .sidebar");
    expect(OPERATOR_UI_CSS).not.toContain(".tyrum-operator-ui .brand");
    expect(OPERATOR_UI_CSS).not.toContain(".tyrum-operator-ui .nav");
    expect(OPERATOR_UI_CSS).not.toContain(".tyrum-operator-ui .main");
  });
});
