import type { OperatorCore } from "@tyrum/operator-core";
import { ContractsCard } from "./admin-http-contracts.js";
import { DeviceTokensCard } from "./admin-http-device-tokens.js";
import { PluginsCard } from "./admin-http-plugins.js";

export function AdminHttpPanels({ core }: { core: OperatorCore }) {
  return (
    <div className="grid gap-4">
      <DeviceTokensCard core={core} />
      <PluginsCard core={core} />
      <ContractsCard />
    </div>
  );
}
