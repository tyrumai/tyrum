export type NodePinnedTransportModule = typeof import("./pinned-transport.js");

export async function loadNodePinnedTransportModule(
  importPrefix: string,
): Promise<NodePinnedTransportModule> {
  const globalAny = globalThis as unknown as Record<PropertyKey, unknown>;
  const specifier =
    `${importPrefix}/node/pinned-transport.js` +
    String(globalAny[Symbol.for("tyrum:node-pinned-transport")] ?? "");
  return (await import(specifier)) as NodePinnedTransportModule;
}
