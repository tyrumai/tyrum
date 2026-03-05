import { describe, expect, it } from "vitest";
import { formatOperatorUiSmokeDiagnostics } from "../helpers/operator-ui-smoke-diagnostics.js";

describe("formatOperatorUiSmokeDiagnostics", () => {
  it("formats operator UI smoke failures with real newlines", () => {
    const message = formatOperatorUiSmokeDiagnostics({
      url: "http://127.0.0.1:3000/ui?token=secret",
      consoleErrors: ["first warning", "second warning"],
      pageErrors: ["page exploded"],
      requestFailures: ["GET /api/status - net::ERR_ABORTED"],
      httpErrors: ["500 GET http://127.0.0.1:3000/ui"],
    });

    expect(message).toBe(
      [
        "Operator UI smoke failed",
        "",
        "url=http://127.0.0.1:3000/ui?token=secret",
        "",
        "console:",
        "first warning",
        "second warning",
        "",
        "pageerror:",
        "page exploded",
        "",
        "requestfailed:",
        "GET /api/status - net::ERR_ABORTED",
        "",
        "http:",
        "500 GET http://127.0.0.1:3000/ui",
      ].join("\n"),
    );
  });
});
