"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getGatewayClient,
  type Watcher,
} from "../../../lib/gateway-client";

type TriggerType = "periodic" | "plan_complete";

export default function WatchersPage() {
  const [watchers, setWatchers] = useState<Watcher[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const isMountedRef = useRef(true);

  // form state
  const [formTriggerType, setFormTriggerType] =
    useState<TriggerType>("periodic");
  const [formIntervalMs, setFormIntervalMs] = useState("60000");
  const [formPlanId, setFormPlanId] = useState("");

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!successMessage) {
      return;
    }
    const timeout = window.setTimeout(() => setSuccessMessage(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [successMessage]);

  const loadWatchers = useCallback(async () => {
    try {
      const client = getGatewayClient();
      const data = await client.getWatchers();
      if (isMountedRef.current) {
        setWatchers(data);
        setError(null);
      }
    } catch (loadError) {
      if (isMountedRef.current) {
        const message =
          loadError instanceof Error && loadError.message
            ? loadError.message
            : "Unable to load watchers.";
        setError(message);
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadWatchers();
  }, [loadWatchers]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreating) {
      return;
    }
    setIsCreating(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const client = getGatewayClient();
      const triggerConfig: Record<string, unknown> =
        formTriggerType === "periodic"
          ? { intervalMs: Number(formIntervalMs) }
          : {};
      const created = await client.createWatcher({
        trigger_type: formTriggerType,
        trigger_config: triggerConfig,
        plan_id: formPlanId,
      });
      if (isMountedRef.current) {
        setWatchers((current) => [...current, created]);
        setSuccessMessage(`Watcher ${created.id} created.`);
        setFormPlanId("");
        setFormIntervalMs("60000");
      }
    } catch (createError) {
      if (isMountedRef.current) {
        const message =
          createError instanceof Error && createError.message
            ? createError.message
            : "Unable to create watcher.";
        setError(message);
      }
    } finally {
      if (isMountedRef.current) {
        setIsCreating(false);
      }
    }
  };

  const handleToggle = async (id: string, active: boolean) => {
    if (busyId) {
      return;
    }
    setBusyId(id);
    setError(null);

    try {
      const client = getGatewayClient();
      const updated = await client.toggleWatcher(id, active);
      if (isMountedRef.current) {
        setWatchers((current) =>
          current.map((w) => (w.id === id ? updated : w)),
        );
        setSuccessMessage(
          `Watcher ${id} ${active ? "activated" : "deactivated"}.`,
        );
      }
    } catch (toggleError) {
      if (isMountedRef.current) {
        const message =
          toggleError instanceof Error && toggleError.message
            ? toggleError.message
            : "Unable to toggle watcher.";
        setError(message);
      }
    } finally {
      if (isMountedRef.current) {
        setBusyId(null);
      }
    }
  };

  const handleDelete = async (id: string) => {
    if (busyId) {
      return;
    }
    setBusyId(id);
    setError(null);

    try {
      const client = getGatewayClient();
      await client.deleteWatcher(id);
      if (isMountedRef.current) {
        setWatchers((current) => current.filter((w) => w.id !== id));
        setSuccessMessage(`Watcher ${id} deleted.`);
      }
    } catch (deleteError) {
      if (isMountedRef.current) {
        const message =
          deleteError instanceof Error && deleteError.message
            ? deleteError.message
            : "Unable to delete watcher.";
        setError(message);
      }
    } finally {
      if (isMountedRef.current) {
        setBusyId(null);
      }
    }
  };

  return (
    <main className="portal-watchers" aria-labelledby="watchers-heading">
      <header className="portal-watchers__header">
        <div>
          <p className="portal-watchers__eyebrow">Portal</p>
          <h1 id="watchers-heading">Watchers</h1>
        </div>
        <p className="portal-watchers__lead">
          Manage automated watchers that trigger plan runs on a schedule or
          event.
        </p>
      </header>

      {error ? (
        <p
          className="portal-watchers__message portal-watchers__message--error"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {!error && successMessage ? (
        <p
          className="portal-watchers__message portal-watchers__message--success"
          role="status"
        >
          {successMessage}
        </p>
      ) : null}

      <section aria-label="Create watcher" className="portal-watchers__form-section">
        <h2 className="portal-watchers__form-title">New Watcher</h2>
        <form onSubmit={handleCreate} className="portal-watchers__form">
          <div className="portal-watchers__field">
            <label htmlFor="trigger-type">Trigger type</label>
            <select
              id="trigger-type"
              value={formTriggerType}
              onChange={(e) =>
                setFormTriggerType(e.target.value as TriggerType)
              }
            >
              <option value="periodic">Periodic</option>
              <option value="plan_complete">Plan complete</option>
            </select>
          </div>

          {formTriggerType === "periodic" ? (
            <div className="portal-watchers__field">
              <label htmlFor="interval-ms">Interval (ms)</label>
              <input
                id="interval-ms"
                type="number"
                min="1000"
                value={formIntervalMs}
                onChange={(e) => setFormIntervalMs(e.target.value)}
                required
              />
            </div>
          ) : null}

          <div className="portal-watchers__field">
            <label htmlFor="plan-id">Plan ID</label>
            <input
              id="plan-id"
              type="text"
              value={formPlanId}
              onChange={(e) => setFormPlanId(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            className="portal-watchers__create-btn"
            disabled={isCreating}
          >
            {isCreating ? "Creating..." : "Create Watcher"}
          </button>
        </form>
      </section>

      <section aria-label="Watcher list" className="portal-watchers__list">
        {isLoading && watchers.length === 0 ? (
          <p className="portal-watchers__placeholder" role="status">
            Loading watchers...
          </p>
        ) : null}
        {!isLoading && watchers.length === 0 && !error ? (
          <p className="portal-watchers__placeholder" role="status">
            No watchers configured.
          </p>
        ) : null}
        {watchers.map((w) => (
          <article key={w.id} className="portal-watchers__card">
            <div className="portal-watchers__card-header">
              <h3 className="portal-watchers__card-id">{w.id}</h3>
              <span
                className={
                  w.active
                    ? "portal-watchers__badge portal-watchers__badge--active"
                    : "portal-watchers__badge portal-watchers__badge--inactive"
                }
              >
                {w.active ? "Active" : "Inactive"}
              </span>
            </div>
            <dl className="portal-watchers__card-details">
              <dt>Trigger</dt>
              <dd>{w.trigger_type}</dd>
              <dt>Plan</dt>
              <dd>{w.plan_id}</dd>
            </dl>
            <div className="portal-watchers__card-actions">
              <button
                type="button"
                onClick={() => handleToggle(w.id, !w.active)}
                disabled={busyId === w.id}
              >
                {w.active ? "Deactivate" : "Activate"}
              </button>
              <button
                type="button"
                className="portal-watchers__delete-btn"
                onClick={() => handleDelete(w.id)}
                disabled={busyId === w.id}
              >
                Delete
              </button>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
