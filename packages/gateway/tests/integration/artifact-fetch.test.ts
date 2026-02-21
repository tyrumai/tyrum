import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TokenStore } from "../../src/modules/auth/token-store.js";
import { createTestApp } from "./helpers.js";
import { ArtifactDal } from "../../src/modules/artifact/dal.js";

describe("artifact fetch routes", () => {
  let homeDir: string | undefined;
  const originalHome = process.env["TYRUM_HOME"];

  afterEach(async () => {
    if (originalHome === undefined) {
      delete process.env["TYRUM_HOME"];
    } else {
      process.env["TYRUM_HOME"] = originalHome;
    }

    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it("streams artifact bytes through the gateway (auth required)", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-artifacts-"));
    process.env["TYRUM_HOME"] = homeDir;

    const tokenStore = new TokenStore(homeDir);
    const token = await tokenStore.initialize();

    const { app, container } = await createTestApp({ tokenStore });
    try {
      const ref = await container.artifactStore.put({
        kind: "log",
        body: Buffer.from("hello", "utf8"),
        mime_type: "text/plain",
        labels: ["test"],
      });

      const artifactDal = new ArtifactDal(container.db);
      await artifactDal.upsertMetadata({
        ref,
        agentId: "default",
        workspaceId: "default",
        runId: "run-test-1",
        stepId: "step-test-1",
        attemptId: "attempt-test-1",
        createdBy: "test",
      });

      const res = await app.request(`/artifact/${ref.artifact_id}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/plain");
      expect(await res.text()).toBe("hello");

      const meta = await app.request(`/artifact/${ref.artifact_id}/meta`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(meta.status).toBe(200);
      const payload = (await meta.json()) as { artifact: { artifact_id: string } };
      expect(payload.artifact.artifact_id).toBe(ref.artifact_id);
    } finally {
      await container.db.close();
    }
  });
});

