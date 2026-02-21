import { useState } from "react";
import { apiFetch } from "../lib/api.js";
import { useApi } from "../hooks/useApi.js";
import { formatDate } from "../lib/format.js";
import { formatJson } from "../lib/format.js";
import { PageHeader } from "../components/PageHeader.js";
import { Card } from "../components/Card.js";
import { Notice } from "../components/Notice.js";
import { LoadingSpinner } from "../components/LoadingSpinner.js";
import { EmptyState } from "../components/EmptyState.js";

interface Watcher {
  id: number;
  plan_id: string;
  trigger_type: string;
  trigger_config: unknown;
  created_at: string;
  active: boolean;
}

export function Watchers() {
  const { data, error, loading, refetch } = useApi<Watcher[]>(
    () => apiFetch<Watcher[]>("/watchers"),
    [],
  );
  const [notice, setNotice] = useState<{ message: string; tone: "ok" | "error" } | null>(null);
  const [mutating, setMutating] = useState(false);

  // Create form state
  const [planId, setPlanId] = useState("");
  const [triggerType, setTriggerType] = useState("periodic");
  const [intervalMs, setIntervalMs] = useState("60000");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!planId.trim() || !triggerType.trim()) {
      setNotice({ message: "Plan ID and trigger type are required", tone: "error" });
      return;
    }
    setMutating(true);
    setNotice(null);
    try {
      const triggerConfig =
        triggerType === "periodic"
          ? { intervalMs: Number.isFinite(parseInt(intervalMs, 10)) ? parseInt(intervalMs, 10) : 60000 }
          : {};
      await apiFetch("/watchers", {
        method: "POST",
        body: JSON.stringify({ plan_id: planId.trim(), trigger_type: triggerType.trim(), trigger_config: triggerConfig }),
      });
      setNotice({ message: "Watcher created.", tone: "ok" });
      setPlanId("");
      setIntervalMs("60000");
      refetch();
    } catch (err) {
      setNotice({ message: err instanceof Error ? err.message : "Create failed", tone: "error" });
    } finally {
      setMutating(false);
    }
  }

  async function handleDeactivate(id: number) {
    setMutating(true);
    setNotice(null);
    try {
      await apiFetch(`/watchers/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: false }),
      });
      setNotice({ message: `Watcher #${id} deactivated.`, tone: "ok" });
      refetch();
    } catch (err) {
      setNotice({ message: err instanceof Error ? err.message : "Deactivate failed", tone: "error" });
    } finally {
      setMutating(false);
    }
  }

  async function handleDelete(id: number) {
    setMutating(true);
    setNotice(null);
    try {
      await apiFetch(`/watchers/${id}`, { method: "DELETE" });
      setNotice({ message: `Watcher #${id} deleted.`, tone: "ok" });
      refetch();
    } catch (err) {
      setNotice({ message: err instanceof Error ? err.message : "Delete failed", tone: "error" });
    } finally {
      setMutating(false);
    }
  }

  if (loading) return <LoadingSpinner />;
  if (error) return <p className="notice error">{error.message}</p>;

  return (
    <>
      <PageHeader title="Watchers" subtitle="Manage periodic and completion-triggered watcher rules." />
      {notice && <Notice message={notice.message} tone={notice.tone} />}

      <Card>
        <h2>Create watcher</h2>
        <form onSubmit={handleCreate}>
          <label htmlFor="watcher-plan-id">Plan ID</label>
          <input
            id="watcher-plan-id"
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
            required
          />

          <label htmlFor="watcher-trigger">Trigger Type</label>
          <select
            id="watcher-trigger"
            value={triggerType}
            onChange={(e) => setTriggerType(e.target.value)}
          >
            <option value="periodic">periodic</option>
            <option value="plan_complete">plan_complete</option>
          </select>

          <label htmlFor="watcher-interval">Interval (ms, periodic only)</label>
          <input
            id="watcher-interval"
            type="number"
            min="1000"
            value={intervalMs}
            onChange={(e) => setIntervalMs(e.target.value)}
          />

          <div className="actions">
            <button type="submit" disabled={mutating}>Create</button>
          </div>
        </form>
      </Card>

      {!data || data.length === 0 ? (
        <EmptyState message="No active watchers." />
      ) : (
        data.map((watcher) => (
          <Card key={watcher.id}>
            <h2>#{watcher.id}</h2>
            <p className="muted">
              {watcher.trigger_type} &middot; plan {watcher.plan_id} &middot; {formatDate(watcher.created_at)}
            </p>
            <pre><code>{formatJson(watcher.trigger_config)}</code></pre>
            <div className="actions">
              <button
                className="secondary"
                type="button"
                disabled={mutating}
                onClick={() => handleDeactivate(watcher.id)}
              >
                Deactivate
              </button>
              <button
                className="danger"
                type="button"
                disabled={mutating}
                onClick={() => handleDelete(watcher.id)}
              >
                Delete
              </button>
            </div>
          </Card>
        ))
      )}
    </>
  );
}
