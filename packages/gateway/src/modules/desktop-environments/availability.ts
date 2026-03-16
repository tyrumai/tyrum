export function isDesktopEnvironmentHostAvailable(host: {
  docker_available: boolean;
  healthy: boolean;
}): boolean {
  return host.healthy && host.docker_available;
}

export function describeDesktopEnvironmentHostAvailability(host: {
  docker_available: boolean;
  healthy: boolean;
  last_error: string | null;
}): string {
  const lastError = host.last_error?.trim();
  if (lastError) return lastError;
  if (!host.docker_available) return "docker unavailable";
  if (!host.healthy) return "host unhealthy";
  return "docker ready";
}
