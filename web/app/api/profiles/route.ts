import { NextResponse } from "next/server";
import { parseUpstreamResponse, resolveApiBaseUrl } from "../shared";

export async function GET() {
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
    const upstreamResponse = await fetch(`${baseUrl}/profiles`, {
      method: "GET",
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
        message: "Unable to load stored profiles upstream.",
      },
      { status: 502 },
    );
  }
}
