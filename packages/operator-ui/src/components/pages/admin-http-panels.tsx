import { ContractsCard } from "./admin-http-contracts.js";
import { DeviceTokensCard } from "./admin-http-device-tokens.js";
import { PluginsCard } from "./admin-http-plugins.js";

export function AdminHttpPanels() {
  return (
    <div className="grid gap-4">
      <DeviceTokensCard />
      <PluginsCard />
      <ContractsCard />
    </div>
  );
}
