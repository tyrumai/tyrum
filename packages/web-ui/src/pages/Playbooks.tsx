import { useState } from "react";
import { apiFetch } from "../lib/api.js";
import { useApi } from "../hooks/useApi.js";
import { PageHeader } from "../components/PageHeader.js";
import { Card } from "../components/Card.js";
import { Notice } from "../components/Notice.js";
import { LoadingSpinner } from "../components/LoadingSpinner.js";
import { EmptyState } from "../components/EmptyState.js";

interface PlaybookManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  steps: unknown[];
}

interface Playbook {
  manifest: PlaybookManifest;
}

export function Playbooks() {
  const { data, error, loading, refetch } = useApi<Playbook[]>(
    () => apiFetch<Playbook[]>("/playbooks"),
    [],
  );
  const [notice, setNotice] = useState<{ message: string; tone: "ok" | "error" } | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  async function handleRun(id: string) {
    setRunning(id);
    setNotice(null);
    try {
      await apiFetch(`/playbooks/${encodeURIComponent(id)}/run`, { method: "POST" });
      setNotice({ message: `Playbook executed successfully.`, tone: "ok" });
      refetch();
    } catch (err) {
      setNotice({ message: err instanceof Error ? err.message : "Run failed", tone: "error" });
    } finally {
      setRunning(null);
    }
  }

  if (loading) return <LoadingSpinner />;
  if (error) return <p className="notice error">{error.message}</p>;

  return (
    <>
      <PageHeader title="Playbooks" subtitle="Trigger repeatable automation flows on demand." />
      {notice && <Notice message={notice.message} tone={notice.tone} />}
      {!data || data.length === 0 ? (
        <EmptyState message="No playbooks loaded." />
      ) : (
        data.map((playbook) => (
          <Card key={playbook.manifest.id}>
            <h2>{playbook.manifest.name}</h2>
            <p className="muted">{playbook.manifest.id} &middot; {playbook.manifest.version}</p>
            <p>{playbook.manifest.description ?? "No description"}</p>
            <p className="muted">{playbook.manifest.steps.length} steps</p>
            <button
              type="button"
              disabled={running === playbook.manifest.id}
              onClick={() => handleRun(playbook.manifest.id)}
            >
              Run
            </button>
          </Card>
        ))
      )}
    </>
  );
}
