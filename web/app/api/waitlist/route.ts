import { NextRequest, NextResponse } from "next/server";
import { parseUpstreamResponse, resolveApiBaseUrl } from "../shared";

async function readJsonBody(request: NextRequest) {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export async function POST(request: NextRequest) {
  const body = await readJsonBody(request);
  if (!body) {
    return NextResponse.json(
      {
        error: "invalid_payload",
        message: "Request body must be valid JSON.",
      },
      { status: 400 },
    );
  }

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
    const upstreamResponse = await fetch(`${baseUrl}/waitlist`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const payload = await parseUpstreamResponse(upstreamResponse);

    return NextResponse.json(payload, { status: upstreamResponse.status });
  } catch {
    return NextResponse.json(
      {
        error: "upstream_unavailable",
        message: "Unable to reach the waitlist service.",
      },
      { status: 502 },
    );
  }
}
