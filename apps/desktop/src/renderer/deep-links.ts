export type DeepLinkRoute =
  | {
      pageId: "work";
      workItemId?: string;
    }
  | {
      pageId: "connection";
    };

function normalizeId(raw: string | null): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function getDeepLinkRoute(rawUrl: string): DeepLinkRoute {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "tyrum:") {
      return { pageId: "connection" };
    }

    const page = parsed.hostname || parsed.pathname.replace(/^\/+/, "");
    if (page === "work") {
      const workItemId = normalizeId(parsed.searchParams.get("work_item_id"));
      return workItemId ? { pageId: "work", workItemId } : { pageId: "work" };
    }
  } catch {
    // ignore invalid URLs
  }

  return { pageId: "connection" };
}
