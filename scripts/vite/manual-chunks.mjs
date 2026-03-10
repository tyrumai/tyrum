export function createTyrumManualChunk(id) {
  const normalizedId = id.split("?")[0]?.replaceAll("\\", "/");
  if (!normalizedId?.includes("/node_modules/")) {
    return undefined;
  }

  const packageName = getNodeModulePackageName(normalizedId);
  if (!packageName) {
    return undefined;
  }
  if (PACKAGES_WITH_EMPTY_CHUNKS.has(packageName)) {
    return undefined;
  }

  return `vendor-${packageName.replace("@", "").replace(/[/.]/g, "-")}`;
}

const PACKAGES_WITH_EMPTY_CHUNKS = new Set([
  "detect-node-es",
  "micromark-extension-gfm-tagfilter",
  "micromark-util-encode",
  "zwitch",
]);

function getNodeModulePackageName(id) {
  const nodeModulesMarker = "/node_modules/";
  const nodeModulesIndex = id.lastIndexOf(nodeModulesMarker);
  if (nodeModulesIndex === -1) {
    return null;
  }

  const packagePath = id.slice(nodeModulesIndex + nodeModulesMarker.length);
  const segments = packagePath.split("/");
  const firstSegment = segments[0];
  if (!firstSegment) {
    return null;
  }

  if (firstSegment.startsWith("@")) {
    const secondSegment = segments[1];
    return secondSegment ? `${firstSegment}/${secondSegment}` : null;
  }

  return firstSegment;
}
