import manifest from "./manifest.generated.json";

type GatewayApiManifest = typeof manifest;

export type GatewayApiManifestHttpOperation = GatewayApiManifest["http"][number];
export type GatewayApiManifestWsRequest = GatewayApiManifest["ws"]["requests"][number];
export type GatewayApiManifestWsEvent = GatewayApiManifest["ws"]["events"][number];

export const gatewayApiManifest = manifest;

function splitPath(path: string): string[] {
  const trimmed = path.replace(/^\/+|\/+$/gu, "");
  if (!trimmed) {
    return [];
  }
  return trimmed.split("/");
}

function isPlaceholderSegment(segment: string): boolean {
  return segment === "*" || segment.startsWith(":") || /^\{[^}]+\}$/u.test(segment);
}

function manifestPathMatches(inputPath: string, manifestPath: string): boolean {
  const inputSegments = splitPath(inputPath);
  const manifestSegments = splitPath(manifestPath);
  let inputIndex = 0;
  let manifestIndex = 0;

  while (inputIndex < inputSegments.length && manifestIndex < manifestSegments.length) {
    const inputSegment = inputSegments[inputIndex];
    const manifestSegment = manifestSegments[manifestIndex];
    if (!inputSegment || !manifestSegment) {
      return false;
    }
    if (manifestSegment === "*") {
      return manifestIndex === manifestSegments.length - 1;
    }
    if (
      inputSegment === manifestSegment ||
      isPlaceholderSegment(inputSegment) ||
      isPlaceholderSegment(manifestSegment)
    ) {
      inputIndex += 1;
      manifestIndex += 1;
      continue;
    }
    return false;
  }

  if (inputIndex === inputSegments.length && manifestIndex === manifestSegments.length) {
    return true;
  }
  return manifestIndex === manifestSegments.length - 1 && manifestSegments[manifestIndex] === "*";
}

const wsRequestByType = new Map(
  gatewayApiManifest.ws.requests.map((request) => [request.type, request]),
);

export function resolveGatewayHttpOperation(input: {
  method: string;
  routePath: string;
}): GatewayApiManifestHttpOperation | null {
  const method = input.method.toUpperCase();
  const match =
    gatewayApiManifest.http.find(
      (operation) =>
        operation.method === method && manifestPathMatches(input.routePath, operation.path),
    ) ??
    (method === "HEAD" || method === "OPTIONS"
      ? gatewayApiManifest.http.find(
          (operation) =>
            operation.method === "GET" && manifestPathMatches(input.routePath, operation.path),
        )
      : undefined);
  return match ?? null;
}

export function resolveGatewayHttpRequiredScopes(input: {
  method: string;
  routePath: string;
}): string[] | null {
  const operation = resolveGatewayHttpOperation(input);
  if (!operation || operation.auth === "public") {
    return null;
  }
  return operation.scopes ?? null;
}

export function resolveGatewayWsRequest(type: string): GatewayApiManifestWsRequest | null {
  return wsRequestByType.get(type) ?? null;
}

export function resolveGatewayWsRequiredScopes(type: string): string[] | null {
  const request = resolveGatewayWsRequest(type);
  if (!request || request.direction !== "client_to_server") {
    return null;
  }
  return request.scopes ?? null;
}
