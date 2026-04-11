const LOOPBACK_HOSTNAME = "localhost";
const FULL_IPV6_LOOPBACK = "0:0:0:0:0:0:0:1";

function normalizeHostForLoopbackCheck(host: string): string {
  const trimmed = host.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function isIpv4Loopback(host: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host)) {
    return false;
  }

  const octets = host.split(".").map((part) => Number.parseInt(part, 10));
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  return octets[0] === 127;
}

export function isLoopbackHost(host: string): boolean {
  const normalized = normalizeHostForLoopbackCheck(host).toLowerCase();
  if (normalized === LOOPBACK_HOSTNAME) {
    return true;
  }

  if (normalized === "::1" || normalized === FULL_IPV6_LOOPBACK) {
    return true;
  }

  return isIpv4Loopback(normalized);
}
