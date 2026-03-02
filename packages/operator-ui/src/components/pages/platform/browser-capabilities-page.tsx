import { Alert } from "../../ui/alert.js";

export function BrowserCapabilitiesPage() {
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight text-fg">Browser Capabilities</h1>
      <Alert
        variant="info"
        title="Coming soon"
        description="Browser-specific capabilities will appear here once implemented."
      />
    </div>
  );
}
