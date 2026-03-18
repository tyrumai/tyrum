import { z, type ZodType } from "zod";
import { ChannelFieldErrors } from "@tyrum/schemas";

import { normalizeFingerprint256 } from "../tls/fingerprint.js";
import { loadNodePinnedTransportModule } from "../load-node-pinned-transport.js";

export const NonEmptyString = z.string().trim().min(1);
const ErrorBodySchema = z
  .object({
    error: z.string().trim().min(1).optional(),
    message: z.string().trim().min(1).optional(),
    field_errors: ChannelFieldErrors.optional(),
  })
  .passthrough();

export type TyrumHttpFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type PinnedNodeRequestInit = RequestInit & { dispatcher?: unknown };

export type TyrumHttpAuthStrategy =
  | {
      type: "bearer";
      token: string;
    }
  | {
      type: "cookie";
      credentials?: RequestCredentials;
    }
  | {
      type: "none";
    };

export interface TyrumHttpClientOptions {
  baseUrl: string;
  auth?: TyrumHttpAuthStrategy;
  fetch?: TyrumHttpFetch;
  headers?: HeadersInit;
  signal?: AbortSignal;
  /**
   * Optional TLS certificate pinning for `https://` connections (Node only).
   *
   * The value is the server certificate's SHA-256 fingerprint, as hex (with or
   * without `:`), case-insensitive. When set, the client will refuse to
   * connect if the remote certificate does not match. Standard TLS verification
   * (CA trust + hostname) still applies by default.
   */
  tlsCertFingerprint256?: string;
  /**
   * When `true`, allows connecting to self-signed TLS certificates when
   * `tlsCertFingerprint256` is configured, by skipping CA verification and
   * relying on the configured fingerprint (plus hostname validation).
   *
   * This is intended for IP-only deployments where using a public CA isn't
   * possible. Verify the fingerprint out-of-band before trusting it.
   */
  tlsAllowSelfSigned?: boolean;
  /**
   * Optional PEM-encoded CA certificate(s) used for Node.js `https://` TLS
   * verification when `tlsCertFingerprint256` is enabled.
   *
   * Use this for private PKI / self-signed deployments, or configure your OS /
   * Node trust store instead.
   */
  tlsCaCertPem?: string;
}

export interface TyrumRequestOptions {
  signal?: AbortSignal;
}

export type TyrumHttpErrorCode =
  | "request_invalid"
  | "response_invalid"
  | "http_error"
  | "network_error";

export class TyrumHttpClientError extends Error {
  readonly code: TyrumHttpErrorCode;
  readonly status?: number;
  readonly error?: string;
  readonly fieldErrors?: z.infer<typeof ChannelFieldErrors>;

  constructor(
    code: TyrumHttpErrorCode,
    message: string,
    options?: {
      cause?: unknown;
      status?: number;
      error?: string;
      fieldErrors?: z.infer<typeof ChannelFieldErrors>;
    },
  ) {
    super(message, options);
    this.name = "TyrumHttpClientError";
    this.code = code;
    this.status = options?.status;
    this.error = options?.error;
    this.fieldErrors = options?.fieldErrors;
  }
}

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type QueryValue = string | number | boolean | null | undefined;
type QueryParams = Record<string, QueryValue | QueryValue[]>;

type RequestOptions<TResponse> = {
  path: string;
  method: HttpMethod;
  query?: QueryParams;
  body?: unknown;
  response: ZodType<TResponse>;
  expectedStatus?: number | readonly number[];
  signal?: AbortSignal;
};

type RawRequestOptions = {
  path: string;
  method: HttpMethod;
  query?: QueryParams;
  body?: unknown;
  expectedStatus?: number | readonly number[];
  signal?: AbortSignal;
  redirect?: RequestRedirect;
  headers?: HeadersInit;
};

function normalizeBaseUrl(rawBaseUrl: string): string {
  const parsed = NonEmptyString.safeParse(rawBaseUrl);
  if (!parsed.success) {
    throw new TyrumHttpClientError(
      "request_invalid",
      `Invalid baseUrl: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }

  const trimmed = parsed.data;
  const withSlash = trimmed.endsWith("/") ? trimmed : `${trimmed}/`;

  try {
    return new URL(withSlash).toString();
  } catch {
    throw new TyrumHttpClientError("request_invalid", "Invalid baseUrl: must be an absolute URL");
  }
}

function toQueryString(params: QueryParams | undefined): string {
  if (!params) return "";

  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null) continue;
        search.append(key, String(item));
      }
      continue;
    }

    search.append(key, String(value));
  }

  const rendered = search.toString();
  return rendered.length > 0 ? `?${rendered}` : "";
}

function normalizePath(path: string): string {
  const parsed = NonEmptyString.safeParse(path);
  if (!parsed.success) {
    throw new TyrumHttpClientError("request_invalid", "path is required");
  }
  return parsed.data.replace(/^\/+/, "");
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const where = issue.path.length > 0 ? issue.path.join(".") : "value";
      return `${where}: ${issue.message}`;
    })
    .join("; ");
}

function isNodeRuntime(): boolean {
  return (
    typeof process !== "undefined" &&
    typeof process.versions === "object" &&
    typeof process.versions.node === "string"
  );
}

function createPinnedNodeFetch(options: {
  pinRaw: string;
  expectedFingerprint256: string;
  allowSelfSigned: boolean;
  caCertPem?: string;
}): TyrumHttpFetch {
  let initPromise:
    | Promise<{
        fetchImpl: (input: RequestInfo | URL, init?: PinnedNodeRequestInit) => Promise<Response>;
        dispatcher: { destroy?: () => Promise<void> | void };
      }>
    | undefined;

  async function init(): Promise<{
    fetchImpl: (input: RequestInfo | URL, init?: PinnedNodeRequestInit) => Promise<Response>;
    dispatcher: { destroy?: () => Promise<void> | void };
  }> {
    const nodeTransport = await loadNodePinnedTransportModule();
    return await nodeTransport.createPinnedNodeTransportState(options);
  }

  return async (input, initOptions) => {
    if (!initPromise) {
      initPromise = init();
    }
    const { fetchImpl, dispatcher } = await initPromise;
    const initWithDispatcher: PinnedNodeRequestInit = initOptions
      ? { ...initOptions, dispatcher }
      : { dispatcher };
    return await fetchImpl(input, initWithDispatcher);
  };
}

async function readJsonBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;

  const contentLength = response.headers.get("content-length");
  if (contentLength === "0") return undefined;

  const text = await response.text();
  if (text.trim().length === 0) return undefined;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function statusIsExpected(
  status: number,
  expectedStatus: number | readonly number[] | undefined,
): boolean {
  if (expectedStatus === undefined) return status >= 200 && status < 300;
  if (Array.isArray(expectedStatus)) return expectedStatus.includes(status);
  return status === expectedStatus;
}

export function validateOrThrow<T>(schema: ZodType<T>, input: unknown, context: string): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new TyrumHttpClientError(
      "request_invalid",
      `${context}: ${formatZodIssues(parsed.error)}`,
    );
  }
  return parsed.data;
}

export class HttpTransport {
  private readonly baseUrl: string;
  private readonly auth: TyrumHttpAuthStrategy;
  private readonly fetchImpl: TyrumHttpFetch;
  private readonly defaultHeaders: Headers;
  private readonly defaultSignal?: AbortSignal;

  constructor(options: TyrumHttpClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.auth = options.auth ?? { type: "none" };
    const pinRaw = (options.tlsCertFingerprint256 ?? "").trim();
    const allowSelfSigned = Boolean(options.tlsAllowSelfSigned);
    const caCertPemRaw = typeof options.tlsCaCertPem === "string" ? options.tlsCaCertPem : "";
    const caCertPemTrimmed = caCertPemRaw.trim();
    const caCertPem = caCertPemTrimmed.length ? caCertPemTrimmed : undefined;

    if (options.fetch) {
      if (pinRaw || allowSelfSigned || caCertPem !== undefined) {
        throw new TyrumHttpClientError(
          "request_invalid",
          "TLS pinning options cannot be used with a custom fetch implementation.",
        );
      }
      this.fetchImpl = options.fetch;
    } else if (!pinRaw && !allowSelfSigned && caCertPem === undefined) {
      // Wrap the global fetch so browser calls retain the correct invocation
      // shape. Calling a stored native Window method as an object property can
      // throw "Illegal invocation" in Chromium.
      this.fetchImpl = (input, init) => fetch(input, init);
    } else {
      if (!pinRaw) {
        if (allowSelfSigned) {
          throw new TyrumHttpClientError(
            "request_invalid",
            "tlsAllowSelfSigned requires tlsCertFingerprint256.",
          );
        }
        throw new TyrumHttpClientError(
          "request_invalid",
          "tlsCaCertPem requires tlsCertFingerprint256.",
        );
      }

      const expectedFingerprint256 = normalizeFingerprint256(pinRaw);
      if (!expectedFingerprint256) {
        throw new TyrumHttpClientError(
          "request_invalid",
          "Invalid tlsCertFingerprint256; expected a SHA-256 hex fingerprint.",
        );
      }

      const url = new URL(this.baseUrl);
      if (url.protocol !== "https:") {
        throw new TyrumHttpClientError(
          "request_invalid",
          "tlsCertFingerprint256 requires an https:// baseUrl.",
        );
      }

      if (!isNodeRuntime()) {
        throw new TyrumHttpClientError(
          "request_invalid",
          "tlsCertFingerprint256 is supported only in Node.js clients.",
        );
      }

      this.fetchImpl = createPinnedNodeFetch({
        pinRaw,
        expectedFingerprint256,
        allowSelfSigned,
        caCertPem,
      });
    }
    this.defaultHeaders = new Headers(options.headers);
    this.defaultSignal = options.signal;
  }

  urlFor(path: string, query?: QueryParams): string {
    const normalizedPath = normalizePath(path);
    const queryString = toQueryString(query);
    return new URL(`${normalizedPath}${queryString}`, this.baseUrl).toString();
  }

  async request<TResponse>(options: RequestOptions<TResponse>): Promise<TResponse> {
    const path = normalizePath(options.path);
    const query = toQueryString(options.query);
    const url = new URL(`${path}${query}`, this.baseUrl).toString();

    const headers = new Headers(this.defaultHeaders);
    const init: RequestInit = {
      method: options.method,
      headers,
    };

    if (options.body !== undefined) {
      if (!headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
      init.body = JSON.stringify(options.body);
    }

    init.signal = options.signal ?? this.defaultSignal;

    switch (this.auth.type) {
      case "bearer":
        headers.set("authorization", `Bearer ${this.auth.token}`);
        break;
      case "cookie":
        init.credentials = this.auth.credentials ?? "include";
        break;
      case "none":
        break;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch (error) {
      throw new TyrumHttpClientError("network_error", "HTTP request failed", { cause: error });
    }

    const parsedBody = await readJsonBody(response);

    if (!statusIsExpected(response.status, options.expectedStatus)) {
      const parsedError = ErrorBodySchema.safeParse(parsedBody);
      const errorCode = parsedError.success ? parsedError.data.error : undefined;
      const errorMessage = parsedError.success
        ? (parsedError.data.message ?? `HTTP ${String(response.status)}`)
        : `HTTP ${String(response.status)}`;

      throw new TyrumHttpClientError("http_error", errorMessage, {
        status: response.status,
        error: errorCode,
        fieldErrors: parsedError.success ? parsedError.data.field_errors : undefined,
      });
    }

    const parsed = options.response.safeParse(parsedBody);
    if (!parsed.success) {
      const detail =
        typeof parsedBody === "string"
          ? "response body is not valid JSON"
          : formatZodIssues(parsed.error);
      throw new TyrumHttpClientError("response_invalid", detail, {
        status: response.status,
      });
    }

    return parsed.data;
  }

  async requestRaw(options: RawRequestOptions): Promise<Response> {
    const path = normalizePath(options.path);
    const query = toQueryString(options.query);
    const url = new URL(`${path}${query}`, this.baseUrl).toString();

    const headers = new Headers(this.defaultHeaders);
    if (options.headers) {
      const extra = new Headers(options.headers);
      for (const [key, value] of extra.entries()) {
        headers.set(key, value);
      }
    }

    const init: RequestInit = {
      method: options.method,
      headers,
    };

    if (options.redirect) {
      init.redirect = options.redirect;
    }

    if (options.body !== undefined) {
      if (!headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
      init.body = JSON.stringify(options.body);
    }

    init.signal = options.signal ?? this.defaultSignal;

    switch (this.auth.type) {
      case "bearer":
        headers.set("authorization", `Bearer ${this.auth.token}`);
        break;
      case "cookie":
        init.credentials = this.auth.credentials ?? "include";
        break;
      case "none":
        break;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch (error) {
      throw new TyrumHttpClientError("network_error", "HTTP request failed", { cause: error });
    }

    if ((response as { type?: string }).type === "opaqueredirect") {
      const expected = options.expectedStatus;
      const expectsRedirect =
        expected === 302 || (Array.isArray(expected) && expected.includes(302));
      if (expectsRedirect) {
        return response;
      }
    }

    if (!statusIsExpected(response.status, options.expectedStatus)) {
      const parsedBody = await readJsonBody(response);

      const parsedError = ErrorBodySchema.safeParse(parsedBody);
      const errorCode = parsedError.success ? parsedError.data.error : undefined;
      const errorMessage = parsedError.success
        ? (parsedError.data.message ?? `HTTP ${String(response.status)}`)
        : `HTTP ${String(response.status)}`;

      throw new TyrumHttpClientError("http_error", errorMessage, {
        status: response.status,
        error: errorCode,
        fieldErrors: parsedError.success ? parsedError.data.field_errors : undefined,
      });
    }

    return response;
  }
}
