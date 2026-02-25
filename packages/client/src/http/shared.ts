import { z, type ZodType } from "zod";

export const NonEmptyString = z.string().trim().min(1);
const ErrorBodySchema = z
  .object({
    error: z.string().trim().min(1).optional(),
    message: z.string().trim().min(1).optional(),
  })
  .strict();

export type TyrumHttpFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

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

  constructor(
    code: TyrumHttpErrorCode,
    message: string,
    options?: {
      cause?: unknown;
      status?: number;
      error?: string;
    },
  ) {
    super(message, options);
    this.name = "TyrumHttpClientError";
    this.code = code;
    this.status = options?.status;
    this.error = options?.error;
  }
}

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

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
    this.fetchImpl = options.fetch ?? fetch;
    this.defaultHeaders = new Headers(options.headers);
    this.defaultSignal = options.signal;
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
}
