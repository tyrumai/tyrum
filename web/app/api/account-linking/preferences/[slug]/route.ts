import { NextRequest, NextResponse } from "next/server";
import { parseUpstreamResponse, resolveApiBaseUrl } from "../shared";

async function readJsonBody(request: NextRequest) {
  try {
    return await request.json();
  } catch (error) {
    return undefined;
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: { slug: string } },
) {
  const slug = context.params?.slug?.trim();
  if (!slug) {
    return NextResponse.json(
      {
        error: "invalid_slug",
        message: "Integration slug must be provided.",
      },
      { status: 400 },
    );
  }

  const body = await readJsonBody(request);
  if (!body || typeof body.enabled !== "boolean") {
    return NextResponse.json(
      {
        error: "invalid_payload",
        message: "Body must include an 'enabled' boolean field.",
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
    const upstreamResponse = await fetch(
      `${baseUrl}/account-linking/preferences/${encodeURIComponent(slug)}`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ enabled: body.enabled }),
        cache: "no-store",
      },
    );

    const payload = await parseUpstreamResponse(upstreamResponse);
    return NextResponse.json(payload, { status: upstreamResponse.status });
  } catch (error) {
    return NextResponse.json(
      {
        error: "upstream_unavailable",
        message: "Unable to update account linking preferences upstream.",
      },
      { status: 502 },
    );
  }
}
