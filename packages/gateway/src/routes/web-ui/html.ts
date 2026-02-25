import type { Context } from "hono";
import { APP_PATH_PREFIX, matchesPathPrefixSegment } from "../../app-path.js";
import { BASE_STYLE } from "./style.js";

export const AUTH_QUERY_PARAM = "token";

// Inline scripts are intentionally minimal; onboarding/settings are server-rendered.

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatJson(value: unknown): string {
  return esc(JSON.stringify(value, null, 2));
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return esc(value);
  return esc(date.toLocaleString());
}

export function extractThreadMessageText(payloadJson: string): string {
  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    if (!parsed || typeof parsed !== "object") return "";
    const message = (parsed as Record<string, unknown>)["message"];
    if (!message || typeof message !== "object") return "";
    const content = (message as Record<string, unknown>)["content"];
    if (!content || typeof content !== "object") return "";

    const kind = (content as Record<string, unknown>)["kind"];
    if (kind === "text") {
      const text = (content as Record<string, unknown>)["text"];
      return typeof text === "string" ? text : "";
    }
    const caption = (content as Record<string, unknown>)["caption"];
    return typeof caption === "string" ? caption : "";
  } catch {
    return "";
  }
}

function messageBanner(search: URLSearchParams): string {
  const msg = search.get("msg");
  if (!msg) return "";
  const tone = search.get("tone") === "error" ? "error" : "ok";
  return `<p class="notice ${tone}">${esc(msg)}</p>`;
}

function getAuthQueryToken(search: URLSearchParams): string | undefined {
  const token = search.get(AUTH_QUERY_PARAM)?.trim();
  return token ? token : undefined;
}

export function withAuthToken(path: string, search: URLSearchParams): string {
  const token = getAuthQueryToken(search);
  if (!token) {
    return path;
  }

  let url: URL;
  try {
    url = new URL(path, "http://tyrum.local");
  } catch {
    return path;
  }

  if (!matchesPathPrefixSegment(url.pathname, APP_PATH_PREFIX)) {
    return path;
  }

  if (!url.searchParams.has(AUTH_QUERY_PARAM)) {
    url.searchParams.set(AUTH_QUERY_PARAM, token);
  }

  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ""}${url.hash}`;
}

export function shell(
  title: string,
  activePath: string,
  search: URLSearchParams,
  body: string,
): string {
  const links = [
    ["/app", "Dashboard"],
    ["/app/session", "Session"],
    ["/app/live", "Live"],
    ["/app/approvals", "Approvals"],
    ["/app/activity", "Activity"],
    ["/app/playbooks", "Playbooks"],
    ["/app/watchers", "Watchers"],
    ["/app/canvas", "Canvas"],
    ["/app/settings", "Settings"],
    ["/app/linking", "Linking"],
    ["/app/onboarding/start", "Onboarding"],
  ] as const;

  const nav = links
    .map(([href, label]) => {
      const active = activePath === href || activePath.startsWith(`${href}/`);
      return `<a href="${withAuthToken(href, search)}" class="${active ? "active" : ""}">${label}</a>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)} | Tyrum</title>
  <style>${BASE_STYLE}</style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">Tyrum</div>
      <p class="brand-sub">Single-user, self-hosted runtime control plane.</p>
      <nav class="nav" aria-label="Primary">${nav}</nav>
    </aside>
    <main class="main">
      ${messageBanner(search)}
      ${body}
    </main>
  </div>
  <script>
    (() => {
      const token = new URLSearchParams(window.location.search).get("token");
      if (!token) return;
      const appPrefix = ${JSON.stringify(APP_PATH_PREFIX)};
      const isAppPath = (pathname) => pathname === appPrefix || pathname.startsWith(appPrefix + "/");

      const rewrite = (raw) => {
        try {
          const url = new URL(raw, window.location.origin);
          if (url.origin !== window.location.origin) return raw;
          if (!isAppPath(url.pathname)) return raw;
          if (!url.searchParams.has("token")) {
            url.searchParams.set("token", token);
          }
          return url.pathname + (url.search || "") + (url.hash || "");
        } catch {
          return raw;
        }
      };

      document.querySelectorAll("a[href]").forEach((node) => {
        const href = node.getAttribute("href");
        if (!href) return;
        node.setAttribute("href", rewrite(href));
      });

      document.querySelectorAll("form[action]").forEach((node) => {
        const action = node.getAttribute("action");
        if (!action) return;
        node.setAttribute("action", rewrite(action));
      });
    })();
  </script>
</body>
</html>`;
}

export function redirectWithMessage(
  path: string,
  message: string,
  tone: "ok" | "error" = "ok",
  search?: URLSearchParams,
): string {
  const params = new URLSearchParams({ msg: message, tone });
  const token = search ? getAuthQueryToken(search) : undefined;
  if (token) {
    params.set(AUTH_QUERY_PARAM, token);
  }
  return `${path}?${params.toString()}`;
}

export function redirectWithMessageFromRequest(
  c: Context,
  path: string,
  message: string,
  tone: "ok" | "error" = "ok",
): string {
  const search = new URL(c.req.url).searchParams;
  return redirectWithMessage(path, message, tone, search);
}

export function boolFromForm(input: FormDataEntryValue | null): boolean {
  if (!input) return false;
  const value = String(input).toLowerCase();
  return value === "1" || value === "true" || value === "on" || value === "yes";
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function humanizeOption(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function renderSelectOptions(options: readonly string[], selected: string): string {
  return options
    .map((option) => {
      const isSelected = option === selected;
      return `<option value="${esc(option)}" ${isSelected ? "selected" : ""}>${esc(humanizeOption(option))}</option>`;
    })
    .join("");
}
