"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getGatewayClient,
  type Playbook,
} from "../../../lib/gateway-client";

export default function PlaybooksPage() {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const isMountedRef = useRef(true);

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

  const loadPlaybooks = useCallback(async () => {
    try {
      const client = getGatewayClient();
      const data = await client.getPlaybooks();
      if (isMountedRef.current) {
        setPlaybooks(data);
        setError(null);
      }
    } catch (loadError) {
      if (isMountedRef.current) {
        const message =
          loadError instanceof Error && loadError.message
            ? loadError.message
            : "Unable to load playbooks.";
        setError(message);
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadPlaybooks();
  }, [loadPlaybooks]);

  const handleRun = async (id: string) => {
    if (runningId) {
      return;
    }
    setRunningId(id);
    setError(null);
    setSuccessMessage(null);

    try {
      const client = getGatewayClient();
      const result = await client.runPlaybook(id);
      if (isMountedRef.current) {
        setSuccessMessage(
          `Playbook started. Run ID: ${result.run_id}`,
        );
      }
    } catch (runError) {
      if (isMountedRef.current) {
        const message =
          runError instanceof Error && runError.message
            ? runError.message
            : "Unable to run playbook.";
        setError(message);
      }
    } finally {
      if (isMountedRef.current) {
        setRunningId(null);
      }
    }
  };

  return (
    <main className="portal-playbooks" aria-labelledby="playbooks-heading">
      <header className="portal-playbooks__header">
        <div>
          <p className="portal-playbooks__eyebrow">Portal</p>
          <h1 id="playbooks-heading">Playbooks</h1>
        </div>
        <p className="portal-playbooks__lead">
          Browse available playbooks and trigger runs on demand.
        </p>
      </header>

      {error ? (
        <p
          className="portal-playbooks__message portal-playbooks__message--error"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {!error && successMessage ? (
        <p
          className="portal-playbooks__message portal-playbooks__message--success"
          role="status"
        >
          {successMessage}
        </p>
      ) : null}

      <section
        aria-label="Playbook list"
        className="portal-playbooks__grid"
      >
        {isLoading && playbooks.length === 0 ? (
          <p className="portal-playbooks__placeholder" role="status">
            Loading playbooks...
          </p>
        ) : null}
        {!isLoading && playbooks.length === 0 && !error ? (
          <p className="portal-playbooks__placeholder" role="status">
            No playbooks available.
          </p>
        ) : null}
        {playbooks.map((pb) => (
          <article key={pb.id} className="portal-playbooks__card">
            <h2 className="portal-playbooks__card-name">{pb.name}</h2>
            <p className="portal-playbooks__card-desc">{pb.description}</p>
            <p className="portal-playbooks__card-steps">
              {pb.steps.length} {pb.steps.length === 1 ? "step" : "steps"}
            </p>
            <button
              type="button"
              className="portal-playbooks__run-btn"
              onClick={() => handleRun(pb.id)}
              disabled={runningId === pb.id}
            >
              {runningId === pb.id ? "Running..." : "Run"}
            </button>
          </article>
        ))}
      </section>
    </main>
  );
}
