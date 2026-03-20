import { describe, expect, it } from "vitest";
import { PlaywrightProvider } from "../../src/providers/playwright-provider.js";
import { MockPlaywrightBackend } from "../test-utils/mock-playwright-backend.js";
import { makeAction, makeProvider } from "../test-utils/playwright-provider-fixture.js";

describe("PlaywrightProvider actions", () => {
  it("hover with selector succeeds", async () => {
    const { provider } = makeProvider();
    const result = await provider.execute(makeAction({ op: "hover", selector: "#menu-item" }));

    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({ type: "hover", selector: "#menu-item" });
  });

  it("hover without selector fails", async () => {
    const { provider } = makeProvider();
    const result = await provider.execute(makeAction({ op: "hover" }));

    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing 'selector'");
  });

  it("drag with source and target selectors succeeds", async () => {
    const { provider } = makeProvider();
    const result = await provider.execute(
      makeAction({ op: "drag", source_selector: "#src", target_selector: "#dst" }),
    );

    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({
      type: "drag",
      sourceSelector: "#src",
      targetSelector: "#dst",
    });
  });

  it("drag without source_selector fails", async () => {
    const { provider } = makeProvider();
    const result = await provider.execute(makeAction({ op: "drag", target_selector: "#dst" }));

    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing 'source_selector' or 'target_selector'");
  });

  it("drag without target_selector fails", async () => {
    const { provider } = makeProvider();
    const result = await provider.execute(makeAction({ op: "drag", source_selector: "#src" }));

    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing 'source_selector' or 'target_selector'");
  });

  it("type with selector and text succeeds", async () => {
    const { provider } = makeProvider();
    await provider.execute(makeAction({ op: "navigate", url: "https://example.com/form" }));
    const result = await provider.execute(
      makeAction({ op: "type", selector: "#input", text: "hello", submit: true }),
    );

    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({
      type: "type",
      selector: "#input",
      text: "hello",
      submit: true,
    });
  });

  it("type without text fails", async () => {
    const { provider } = makeProvider();
    const result = await provider.execute(makeAction({ op: "type", selector: "#input" }));

    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing 'selector' or 'text'");
  });

  it("type without selector fails", async () => {
    const { provider } = makeProvider();
    const result = await provider.execute(makeAction({ op: "type", text: "hello" }));

    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing 'selector' or 'text'");
  });

  it("select_option with selector and values succeeds", async () => {
    const { provider } = makeProvider();
    const result = await provider.execute(
      makeAction({ op: "select_option", selector: "#dropdown", values: ["a", "b"] }),
    );

    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({
      type: "select_option",
      selector: "#dropdown",
      selected: ["a", "b"],
    });
  });

  it("select_option without values fails", async () => {
    const { provider } = makeProvider();
    const result = await provider.execute(
      makeAction({ op: "select_option", selector: "#dropdown" }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing 'selector' or 'values'");
  });

  it("press_key with key succeeds", async () => {
    const { provider } = makeProvider();
    const result = await provider.execute(
      makeAction({ op: "press_key", key: "Enter", modifiers: ["Shift"] }),
    );

    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({
      type: "press_key",
      key: "Enter",
      modifiers: ["Shift"],
    });
  });

  it("press_key without key fails", async () => {
    const { provider } = makeProvider();
    const result = await provider.execute(makeAction({ op: "press_key" }));

    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing 'key'");
  });

  it("screenshot returns base64 image", async () => {
    const { provider } = makeProvider();
    const result = await provider.execute(
      makeAction({ op: "screenshot", selector: "#hero", full_page: true }),
    );

    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({
      type: "screenshot",
      mime: "image/png",
      bytesBase64: "bW9jaw==",
    });
  });

  it("screenshot without selector takes full-page screenshot", async () => {
    const { provider } = makeProvider();
    const result = await provider.execute(makeAction({ op: "screenshot" }));

    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({ type: "screenshot" });
  });

  it("evaluate with expression succeeds", async () => {
    const { provider } = makeProvider();
    const result = await provider.execute(
      makeAction({ op: "evaluate", expression: "document.title" }),
    );

    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({ type: "evaluate" });
  });

  it("evaluate without expression fails", async () => {
    const { provider } = makeProvider();
    const result = await provider.execute(makeAction({ op: "evaluate" }));

    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing 'expression'");
  });

  it("wait_for with options succeeds", async () => {
    const { provider } = makeProvider();
    const result = await provider.execute(
      makeAction({ op: "wait_for", selector: "#loaded", timeout_ms: 5000 }),
    );

    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({
      type: "wait_for",
      matched: true,
      selector: "#loaded",
    });
  });

  it("wait_for with url pattern succeeds", async () => {
    const { provider } = makeProvider();
    const result = await provider.execute(
      makeAction({ op: "wait_for", url: "https://example.com/done" }),
    );

    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({
      type: "wait_for",
      matched: true,
      url: "https://example.com/done",
    });
  });

  it("upload_file with selector and paths succeeds", async () => {
    const { provider } = makeProvider();
    const result = await provider.execute(
      makeAction({
        op: "upload_file",
        selector: "#file-input",
        paths: ["/tmp/a.txt", "/tmp/b.txt"],
      }),
    );

    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({
      type: "upload_file",
      selector: "#file-input",
      filesUploaded: 2,
    });
  });

  it("upload_file without paths fails", async () => {
    const { provider } = makeProvider();
    const result = await provider.execute(
      makeAction({ op: "upload_file", selector: "#file-input" }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing 'selector' or 'paths'");
  });

  it("resize with width and height succeeds", async () => {
    const { provider } = makeProvider();
    const result = await provider.execute(makeAction({ op: "resize", width: 1280, height: 720 }));

    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({ type: "resize", width: 1280, height: 720 });
  });

  it("resize without height fails", async () => {
    const { provider } = makeProvider();
    const result = await provider.execute(makeAction({ op: "resize", width: 1280 }));

    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing 'width' or 'height'");
  });

  it("close succeeds", async () => {
    const { provider } = makeProvider();
    const result = await provider.execute(makeAction({ op: "close" }));

    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({ type: "close" });
  });

  it("handle_dialog with accept succeeds", async () => {
    const { provider } = makeProvider();
    const result = await provider.execute(
      makeAction({ op: "handle_dialog", accept: true, prompt_text: "yes" }),
    );

    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({ type: "handle_dialog" });
  });

  it("handle_dialog with dismiss succeeds", async () => {
    const { provider } = makeProvider();
    const result = await provider.execute(makeAction({ op: "handle_dialog", accept: false }));

    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({ type: "handle_dialog" });
  });

  it("handle_dialog without accept fails", async () => {
    const { provider } = makeProvider();
    const result = await provider.execute(makeAction({ op: "handle_dialog" }));

    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing 'accept'");
  });

  it("run_code with code succeeds", async () => {
    const { provider } = makeProvider();
    const result = await provider.execute(makeAction({ op: "run_code", code: "return 42" }));

    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({ type: "run_code" });
  });

  it("run_code without code fails", async () => {
    const { provider } = makeProvider();
    const result = await provider.execute(makeAction({ op: "run_code" }));

    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing 'code'");
  });

  it("backend error is caught and returned as failure", async () => {
    const backend = new MockPlaywrightBackend();
    backend.hover = async () => {
      throw new Error("element detached");
    };
    const provider = new PlaywrightProvider(
      { allowedDomains: ["example.com"], headless: true, domainRestricted: true },
      backend,
    );
    const result = await provider.execute(makeAction({ op: "hover", selector: "#gone" }));

    expect(result.success).toBe(false);
    expect(result.error).toContain("element detached");
  });
});
