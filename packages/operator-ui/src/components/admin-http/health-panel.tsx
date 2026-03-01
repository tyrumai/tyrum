import { ApiResultCard } from "../ui/api-result-card.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { useApiAction } from "./admin-http-shared.js";

export function HealthPanel() {
  const action = useApiAction<unknown>();

  const fetchHealth = (): void => {
    void action.run(async () => {
      const response = await fetch("/healthz", { credentials: "omit", cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Health check failed (${response.status})`);
      }
      return (await response.json()) as unknown;
    });
  };

  return (
    <Card data-testid="admin-http-health-panel">
      <CardHeader>
        <div className="text-sm font-medium text-fg">Health</div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap gap-2">
          <Button
            data-testid="admin-http-health-fetch"
            isLoading={action.isLoading}
            onClick={() => {
              fetchHealth();
            }}
          >
            Fetch /healthz
          </Button>
          <Button
            variant="secondary"
            disabled={action.isLoading}
            onClick={() => {
              action.reset();
            }}
          >
            Clear
          </Button>
        </div>
        <ApiResultCard
          data-testid="admin-http-health-result"
          heading="Health result"
          value={action.value}
          error={action.error}
          jsonViewerProps={{ defaultExpandedDepth: 2 }}
        />
      </CardContent>
    </Card>
  );
}
