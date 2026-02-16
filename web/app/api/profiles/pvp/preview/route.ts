import { NextResponse } from "next/server";
import { parseUpstreamResponse, resolveApiBaseUrl } from "../../../shared";

export async function POST() {
  const baseUrl = resolveApiBaseUrl();
  if (!baseUrl) {
    return NextResponse.json(
      {
        error: "configuration",
        message: "API_BASE_URL is not configured.",
      },
      { status: 500 },
    );
  }

  try {
    const upstreamResponse = await fetch(`${baseUrl}/profiles/pvp/preview`, {
      method: "POST",
      headers: {
        accept: "application/json",
      },
      cache: "no-store",
    });

    const payload = await parseUpstreamResponse(upstreamResponse);
    return NextResponse.json(payload, { status: upstreamResponse.status });
  } catch {
    return NextResponse.json(
      {
        error: "upstream_unavailable",
        message: "Unable to fetch voice preview from the API.",
      },
      { status: 502 },
    );
  }
}
