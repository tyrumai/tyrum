import type { TyrumHttpAuthStrategy } from "@tyrum/client";
import type { AdminModeState } from "./stores/admin-mode-store.js";

export type OperatorAuthStrategy =
  | {
      type: "browser-cookie";
      credentials?: RequestCredentials;
    }
  | {
      type: "bearer-token";
      token: string;
    };

export function createBrowserCookieAuth(options?: {
  credentials?: RequestCredentials;
}): OperatorAuthStrategy {
  return {
    type: "browser-cookie",
    credentials: options?.credentials,
  };
}

export function createBearerTokenAuth(token: string): OperatorAuthStrategy {
  return { type: "bearer-token", token };
}

export function selectAuthForAdminMode(options: {
  baseline: OperatorAuthStrategy;
  adminMode: AdminModeState;
}): OperatorAuthStrategy {
  const elevatedToken =
    options.adminMode.status === "active" ? options.adminMode.elevatedToken : null;
  if (!elevatedToken) return options.baseline;
  return { type: "bearer-token", token: elevatedToken };
}

export function wsTokenForAuth(auth: OperatorAuthStrategy): string {
  switch (auth.type) {
    case "browser-cookie":
      return "";
    case "bearer-token":
      return auth.token;
  }
}

export function httpAuthForAuth(auth: OperatorAuthStrategy): TyrumHttpAuthStrategy {
  switch (auth.type) {
    case "browser-cookie":
      return { type: "cookie", credentials: auth.credentials };
    case "bearer-token":
      return { type: "bearer", token: auth.token };
  }
}
