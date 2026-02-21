import { useState } from "react";
import { apiFetch } from "../lib/api.js";
import { useApi } from "../hooks/useApi.js";
import { PageHeader } from "../components/PageHeader.js";
import { Card } from "../components/Card.js";
import { LoadingSpinner } from "../components/LoadingSpinner.js";
import { Notice } from "../components/Notice.js";

interface Integration {
  name: string;
  slug: string;
  description: string;
  enabled: boolean;
}

interface LinkingResponse {
  account_id: string;
  integrations: Integration[];
}

export function Linking() {
  const { data, error, loading, refetch } = useApi<LinkingResponse>(
    () => apiFetch<LinkingResponse>("/api/account-linking/preferences"),
    [],
  );

  const [notice, setNotice] = useState<{ message: string; tone: "ok" | "error" } | null>(null);

  if (loading) return <LoadingSpinner />;
  if (error) return <p className="notice error">{error.message}</p>;
  if (!data) return null;

  async function toggle(slug: string, currentlyEnabled: boolean) {
    setNotice(null);
    try {
      await apiFetch(`/api/account-linking/preferences/${encodeURIComponent(slug)}`, {
        method: "PUT",
        body: JSON.stringify({ enabled: !currentlyEnabled }),
      });
      refetch();
      const integration = data!.integrations.find((i) => i.slug === slug);
      const name = integration?.name ?? slug;
      setNotice({ message: `${name} ${currentlyEnabled ? "disabled" : "enabled"}.`, tone: "ok" });
    } catch (err) {
      setNotice({ message: err instanceof Error ? err.message : "Toggle failed.", tone: "error" });
    }
  }

  return (
    <>
      <PageHeader title="Account Linking" subtitle="Toggle placeholder connectors while integration controls remain local-only." />

      {notice && <Notice message={notice.message} tone={notice.tone} />}

      <p className="muted">Account ID: {data.account_id}</p>

      {data.integrations.map((integration) => (
        <Card key={integration.slug}>
          <h2>{integration.name}</h2>
          <p className="muted">{integration.slug}</p>
          <p>{integration.description}</p>
          <p><strong>Status:</strong> {integration.enabled ? "Enabled" : "Disabled"}</p>
          <button
            type="button"
            className={integration.enabled ? "danger" : ""}
            onClick={() => toggle(integration.slug, integration.enabled)}
          >
            {integration.enabled ? "Disable" : "Enable"}
          </button>
        </Card>
      ))}
    </>
  );
}
