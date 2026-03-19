export type NodePinnedTransportModule = typeof import("./node/pinned-transport.js");

export async function loadNodePinnedTransportModule(): Promise<NodePinnedTransportModule> {
  const globalAny = globalThis as unknown as Record<PropertyKey, unknown>;
  const specifier =
    "./node/pinned-transport.js" +
    String(globalAny[Symbol.for("tyrum:node-pinned-transport")] ?? "");
  return (await import(specifier)) as NodePinnedTransportModule;
}
