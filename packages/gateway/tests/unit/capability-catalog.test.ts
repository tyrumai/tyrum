import { CAPABILITY_DESCRIPTOR_DEFAULT_VERSION } from "@tyrum/contracts";
import { describe, expect, it } from "vitest";
import {
  getCapabilityCatalogAction,
  getCapabilityCatalogEntry,
  listCapabilityCatalogEntries,
} from "../../src/modules/node/capability-catalog.js";

describe("capability catalog", () => {
  it("keeps the expected entry count and representative capability ids", () => {
    const entryIds = listCapabilityCatalogEntries().map((entry) => entry.descriptor.id);

    expect(entryIds).toHaveLength(40);
    expect(entryIds).toContain("tyrum.desktop.screenshot");
    expect(entryIds).toContain("tyrum.location.get");
    expect(entryIds).toContain("tyrum.browser.run-code");
    expect(entryIds).toContain("tyrum.fs.write");
  });

  it("preserves descriptor metadata and browser transport details", () => {
    const entry = getCapabilityCatalogEntry("tyrum.browser.run-code");
    const action = getCapabilityCatalogAction("tyrum.browser.navigate", "navigate");

    expect(entry).toMatchObject({
      descriptor: {
        id: "tyrum.browser.run-code",
        version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
      },
    });
    expect(action).toMatchObject({
      name: "navigate",
      transport: {
        primitive_kind: "Web",
        op_field: "op",
        op_value: "navigate",
        result_channel: "result_or_evidence",
      },
    });
  });

  it("preserves consent and transport metadata across capability families", () => {
    const locationAction = getCapabilityCatalogAction("tyrum.location.get", "get");
    const filesystemAction = getCapabilityCatalogAction("tyrum.fs.write", "write");

    expect(locationAction).toMatchObject({
      consent: {
        requires_operator_enable: true,
        requires_runtime_consent: true,
        may_prompt_user: true,
        sensitive_data_category: "location",
      },
      transport: {
        primitive_kind: null,
        result_channel: "evidence",
      },
    });
    expect(filesystemAction).toMatchObject({
      consent: {
        sensitive_data_category: "filesystem",
      },
      transport: {
        primitive_kind: "Filesystem",
        result_channel: "result",
      },
    });
  });

  it("accepts an injected op field for strict schema-backed action parsers", () => {
    const browserAction = getCapabilityCatalogAction("tyrum.browser.navigate", "navigate");
    const sensorAction = getCapabilityCatalogAction("tyrum.location.get", "get");

    expect(() =>
      browserAction?.inputParser.parse({
        op: "navigate",
        url: "https://example.com",
      }),
    ).not.toThrow();
    expect(() => sensorAction?.inputParser.parse({ op: "get" })).not.toThrow();
  });
});
