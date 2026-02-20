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
      steps: [{ id: "step-1", command: "research test" }],
    };
    const result = PlaybookManifest.parse(raw);
    expect(result.id).toBe("my-pb");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]!.id).toBe("step-1");
  });

  it("rejects manifest with missing required fields", () => {
    expect(() => PlaybookManifest.parse({ name: "Incomplete" })).toThrow();
  });

  it("rejects manifest with missing step command", () => {
    const raw = {
      id: "bad-action",
      name: "Bad",
      version: "1.0.0",
      steps: [{ id: "s1" }],
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
          id: "step",
          name: "Step",
          command: "http GET https://example.com",
          stdin: "$prev.stdout",
          condition: "$prev.ok",
          approval: "required",
          output: "json",
          postcondition: {
            assertions: [{ type: "http_status", equals: 200 }],
          },
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
    expect(result.steps[0]!.command).toBe("http GET https://example.com");
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

  it("rejects manifest with duplicate step ids", () => {
    const raw = {
      id: "dup",
      name: "Dup",
      version: "1.0.0",
      steps: [
        { id: "s1", command: "research a" },
        { id: "s1", command: "research b" },
      ],
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
    const playbooks = loadAllPlaybooks(fixturesDir, {
      onInvalidPlaybook: () => {},
    });
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

  function makePlaybook(
    id: string,
    steps: Array<{ id: string; command: string; name?: string }>,
  ) {
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
      { id: "research", command: "research hello" },
      { id: "message", command: "message to=user body=sent" },
    ]);

    const result = runner.run(pb);
    expect(result.playbook_id).toBe("conv-test");
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]!.type).toBe("Research");
    expect(result.steps[0]!.args).toEqual({
      query: "hello",
      __playbook: {
        playbook_id: "conv-test",
        step_id: "research",
        step_name: null,
        stdin: null,
        condition: null,
        approval: null,
        output: null,
      },
    });
    expect(result.steps[1]!.type).toBe("Message");
    expect(result.steps[1]!.args).toEqual({
      to: "user",
      body: "sent",
      __playbook: {
        playbook_id: "conv-test",
        step_id: "message",
        step_name: null,
        stdin: null,
        condition: null,
        approval: null,
        output: null,
      },
    });
    expect(result.steps[0]!.idempotency_key).toBe("playbook:conv-test:research");
    expect(result.steps[1]!.idempotency_key).toBe("playbook:conv-test:message");
    expect(result.created_at).toBeDefined();
  });

  it("tracks execution stats", () => {
    const runner2 = new PlaybookRunner();
    const pb = makePlaybook("stats-test", [
      { id: "step", command: "research x" },
    ]);

    runner2.run(pb);
    runner2.run(pb);
    runner2.run(pb);

    const stats = runner2.getStats();
    expect(stats).toHaveLength(1);
    expect(stats[0]!.playbook_id).toBe("stats-test");
    expect(stats[0]!.run_count).toBe(3);
  });

  it("compiles cli/web/llm namespaces into executable primitives", () => {
    const pb = makePlaybook("ns-test", [
      { id: "cli", command: "cli echo \"hello world\"" },
      { id: "web", command: "web navigate https://example.com" },
      { id: "llm", command: "llm draft a short summary" },
    ]);

    const result = runner.run(pb);
    expect(result.steps).toHaveLength(3);

    expect(result.steps[0]!.type).toBe("CLI");
    expect(result.steps[0]!.args).toEqual({
      cmd: "echo",
      args: ["hello world"],
      __playbook: {
        playbook_id: "ns-test",
        step_id: "cli",
        step_name: null,
        stdin: null,
        condition: null,
        approval: null,
        output: null,
      },
    });
    expect(result.steps[0]!.idempotency_key).toBe("playbook:ns-test:cli");

    expect(result.steps[1]!.type).toBe("Web");
    expect(result.steps[1]!.args).toEqual({
      op: "navigate",
      url: "https://example.com",
      __playbook: {
        playbook_id: "ns-test",
        step_id: "web",
        step_name: null,
        stdin: null,
        condition: null,
        approval: null,
        output: null,
      },
    });
    expect(result.steps[1]!.idempotency_key).toBe("playbook:ns-test:web");

    expect(result.steps[2]!.type).toBe("Decide");
    expect(result.steps[2]!.args).toEqual({
      prompt: "draft a short summary",
      __playbook: {
        playbook_id: "ns-test",
        step_id: "llm",
        step_name: null,
        stdin: null,
        condition: null,
        approval: null,
        output: null,
      },
    });
    expect(result.steps[2]!.idempotency_key).toBe("playbook:ns-test:llm");
  });
});
