import { HTTP_PUBLIC_ALLOWLIST } from "./paths.mjs";

const METHOD_SCOPED_OPERATOR_ROUTE_PREFIXES = [
  "/",
  "/agent",
  "/automation",
  "/artifacts",
  "/canvas",
  "/connections",
  "/context",
  "/contracts",
  "/ingress",
  "/memory",
  "/metrics",
  "/models",
  "/location",
  "/plan",
  "/playbooks",
  "/presence",
  "/specs",
  "/runs",
  "/status",
  "/usage",
  "/watchers",
  "/workflow",
];

function matchesPathPrefixSegment(routePath, prefix) {
  if (routePath === prefix) {
    return true;
  }
  return routePath.startsWith(`${prefix}/`);
}

function isReadOnlyMethod(method) {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

function isMethodScopedOperatorRoute(routePath) {
  if (routePath === "/") {
    return true;
  }
  return METHOD_SCOPED_OPERATOR_ROUTE_PREFIXES.some((prefix) =>
    matchesPathPrefixSegment(routePath, prefix),
  );
}

function isExtensionsInventoryRoute(routePath) {
  const segments = routePath.split("/").filter((segment) => segment.length > 0);
  if (segments[0] !== "config" || segments[1] !== "extensions") {
    return false;
  }
  return segments.length === 3 || segments.length === 4;
}

export function manifestRouteKey(method, path) {
  const normalizedPath = path
    .replace(/:([A-Za-z0-9_]+)/gu, "{param}")
    .replace(/\{[^}]+\}/gu, "{param}");
  return `${method.toUpperCase()} ${normalizedPath}`;
}

export function resolveHttpScopeEntry(method, pathTemplate) {
  const normalizedPath = pathTemplate.replace(/\{[^}]+\}/gu, ":id");
  if (HTTP_PUBLIC_ALLOWLIST.has(`${method} ${normalizedPath}`)) {
    return { auth: "public", scopes: null };
  }

  if (isReadOnlyMethod(method) && isExtensionsInventoryRoute(normalizedPath)) {
    return { auth: "required", scopes: ["operator.read"] };
  }

  if (
    [
      "/agents",
      "/auth",
      "/audit",
      "/config",
      "/desktop-environment-hosts",
      "/desktop-environments",
      "/policy",
      "/routing",
      "/plugins",
      "/providers",
      "/secrets",
      "/snapshot",
    ].some((prefix) => normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`))
  ) {
    return { auth: "required", scopes: ["operator.admin"] };
  }

  if (normalizedPath === "/models/refresh" || normalizedPath.startsWith("/models/overrides")) {
    return { auth: "required", scopes: ["operator.admin"] };
  }
  if (normalizedPath.startsWith("/approvals")) {
    return {
      auth: "required",
      scopes: [isReadOnlyMethod(method) ? "operator.read" : "operator.approvals"],
    };
  }
  if (normalizedPath.startsWith("/pairings")) {
    return {
      auth: "required",
      scopes: [isReadOnlyMethod(method) ? "operator.read" : "operator.pairing"],
    };
  }

  if (!isMethodScopedOperatorRoute(normalizedPath)) {
    return { auth: "required", scopes: null };
  }

  if (isReadOnlyMethod(method)) {
    return { auth: "required", scopes: ["operator.read"] };
  }
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    return { auth: "required", scopes: ["operator.write"] };
  }

  return { auth: "required", scopes: null };
}
