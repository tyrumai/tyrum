import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../../src/app.js";
import { createTestContainer } from "./helpers.js";

describe("artifact routes", () => {
  let originalTyrumHome: string | undefined;
  let homeDir: string | undefined;

  beforeEach(async () => {
    originalTyrumHome = process.env["TYRUM_HOME"];
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-artifacts-"));
    process.env["TYRUM_HOME"] = homeDir;
  });

  afterEach(async () => {
    if (originalTyrumHome === undefined) {
      delete process.env["TYRUM_HOME"];
    } else {
      process.env["TYRUM_HOME"] = originalTyrumHome;
    }

    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it("GET /artifacts/:id streams bytes for stored artifacts with metadata", async () => {
    const container = await createTestContainer();
    const app = createApp(container);

    const ref = await container.artifactStore.put({
      kind: "log",
      mime_type: "text/plain",
      body: Buffer.from("hello", "utf8"),
      labels: ["log"],
      metadata: { test: true },
    });

    await container.db.run(
      `INSERT INTO execution_artifacts (
         artifact_id,
         workspace_id,
         agent_id,
         run_id,
         step_id,
         attempt_id,
         kind,
         uri,
         created_at,
         mime_type,
         size_bytes,
         sha256,
         labels_json,
         metadata_json,
         sensitivity,
         policy_snapshot_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ref.artifact_id,
        "default",
        null,
        null,
        null,
        null,
        ref.kind,
        ref.uri,
        ref.created_at,
        ref.mime_type ?? null,
        ref.size_bytes ?? null,
        ref.sha256 ?? null,
        JSON.stringify(ref.labels ?? []),
        JSON.stringify(ref.metadata ?? {}),
        "normal",
        null,
      ],
    );

    const metaRes = await app.request(`/artifacts/${ref.artifact_id}/metadata`);
    expect(metaRes.status).toBe(200);
    const metaBody = (await metaRes.json()) as { artifact: { uri: string; kind: string } };
    expect(metaBody.artifact.uri).toBe(ref.uri);
    expect(metaBody.artifact.kind).toBe(ref.kind);

    const res = await app.request(`/artifacts/${ref.artifact_id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(await res.text()).toBe("hello");

    await container.db.close();
  });
});

