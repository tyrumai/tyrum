import type { OperatorCore } from "@tyrum/operator-core";
import { MemoryInspector } from "../memory/memory-inspector.js";

export function MemoryPage({ core }: { core: OperatorCore }) {
  return <MemoryInspector core={core} />;
}
