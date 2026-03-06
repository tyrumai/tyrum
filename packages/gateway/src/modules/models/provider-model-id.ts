export function normalizeProviderScopedModelId(providerId: string, modelId: string): string {
  const normalizedProviderId = providerId.trim();
  const normalizedModelId = modelId.trim();
  if (!normalizedProviderId || !normalizedModelId) return normalizedModelId;

  const redundantPrefix = `${normalizedProviderId}/`;
  return normalizedModelId.startsWith(redundantPrefix)
    ? normalizedModelId.slice(redundantPrefix.length)
    : normalizedModelId;
}
