import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PlaybookManifest } from "@tyrum/schemas";
import { loadPlaybook, loadAllPlaybooks } from "../../src/modules/playbook/loader.js";
import { PlaybookRunner } from "../../src/modules/playbook/runner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "../fixtures/playbooks");

describe("PlaybookManifest schema", () => {
  it("parses a valid manifest", () => {
    const raw = {
      id: "my-pb",
      name: "My Playbook",
      version: "1.0.0",
      steps: [{ name: "Step 1", action: "Research", args: { query: "test" } }],
    };
    const result = PlaybookManifest.parse(raw);
    expect(result.id).toBe("my-pb");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]!.action).toBe("Research");
  });

  it("rejects manifest with missing required fields", () => {
    expect(() => PlaybookManifest.parse({ name: "Incomplete" })).toThrow();
  });

  it("rejects manifest with invalid action kind", () => {
    const raw = {
      id: "bad-action",
      name: "Bad",
      version: "1.0.0",
      steps: [{ name: "Step", action: "InvalidAction" }],
    };
    expect(() => PlaybookManifest.parse(raw)).toThrow();
  });

  it("allows optional fields", () => {
    const raw = {
      id: "full",
      name: "Full Playbook",
      description: "A fully specified playbook",
      version: "1.0.0",
      steps: [
        {
          name: "Step",
          action: "Web",
          args: { url: "https://example.com" },
          postcondition: "page loaded",
          rollback_hint: "try again",
        },
      ],
      allowed_domains: ["example.com"],
      consent_boundary: "requires_approval",
    };
    const result = PlaybookManifest.parse(raw);
    expect(result.description).toBe("A fully specified playbook");
    expect(result.allowed_domains).toEqual(["example.com"]);
    expect(result.consent_boundary).toBe("requires_approval");
    expect(result.steps[0]!.postcondition).toBe("page loaded");
    expect(result.steps[0]!.rollback_hint).toBe("try again");
  });

  it("rejects manifest with empty steps", () => {
    const raw = {
      id: "empty",
      name: "Empty",
      version: "1.0.0",
      steps: [],
    };
    expect(() => PlaybookManifest.parse(raw)).toThrow();
  });
});

describe("loadPlaybook", () => {
  it("loads a valid YAML playbook", () => {
    const pb = loadPlaybook(join(fixturesDir, "test-playbook/playbook.yml"));
    expect(pb.manifest.id).toBe("test-playbook");
    expect(pb.manifest.name).toBe("Test Playbook");
    expect(pb.manifest.version).toBe("1.0.0");
    expect(pb.manifest.steps).toHaveLength(3);
    expect(pb.file_path).toContain(join("test-playbook", "playbook.yml"));
    expect(pb.loaded_at).toBeDefined();
  });

  it("throws for an invalid YAML playbook", () => {
    expect(() =>
      loadPlaybook(join(fixturesDir, "invalid-playbook/playbook.yml")),
    ).toThrow();
  });

  it("throws for a nonexistent file", () => {
    expect(() => loadPlaybook("/nonexistent/playbook.yml")).toThrow();
  });
});

describe("loadAllPlaybooks", () => {
  it("loads all valid playbooks from a directory", () => {
    const playbooks = loadAllPlaybooks(fixturesDir);
    // Should load test-playbook and second-playbook; invalid-playbook is skipped
    const ids = playbooks.map((p) => p.manifest.id).sort();
    expect(ids).toContain("test-playbook");
    expect(ids).toContain("second-playbook");
    expect(ids).not.toContain("invalid-playbook");
  });

  it("returns empty array for nonexistent directory", () => {
    const playbooks = loadAllPlaybooks("/nonexistent/dir");
    expect(playbooks).toHaveLength(0);
  });
});

describe("PlaybookRunner", () => {
  const runner = new PlaybookRunner();

  function makePlaybook(id: string, steps: Array<{ name: string; action: string; args?: Record<string, unknown>; postcondition?: string }>) {
    return {
      manifest: PlaybookManifest.parse({
        id,
        name: `Playbook ${id}`,
        version: "1.0.0",
        steps,
      }),
      file_path: `/test/${id}/playbook.yml`,
      loaded_at: new Date().toISOString(),
    };
  }

  it("converts steps to action primitives", () => {
    const pb = makePlaybook("conv-test", [
      { name: "Research", action: "Research", args: { query: "hello" } },
      { name: "Message", action: "Message", args: { to: "user" }, postcondition: "sent" },
    ]);

    const result = runner.run(pb);
    expect(result.playbook_id).toBe("conv-test");
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]!.type).toBe("Research");
    expect(result.steps[0]!.args).toEqual({ query: "hello" });
    expect(result.steps[1]!.type).toBe("Message");
    expect(result.steps[1]!.postcondition).toBe("sent");
    expect(result.steps[0]!.idempotency_key).toBe("playbook-step-0");
    expect(result.steps[1]!.idempotency_key).toBe("playbook-step-1");
    expect(result.created_at).toBeDefined();
  });

  it("tracks execution stats", () => {
    const runner2 = new PlaybookRunner();
    const pb = makePlaybook("stats-test", [
      { name: "Step", action: "Research", args: { q: "x" } },
    ]);

    runner2.run(pb);
    runner2.run(pb);
    runner2.run(pb);

    const stats = runner2.getStats();
    expect(stats).toHaveLength(1);
    expect(stats[0]!.playbook_id).toBe("stats-test");
    expect(stats[0]!.run_count).toBe(3);
  });
});
