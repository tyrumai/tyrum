import { NextResponse } from "next/server";
import { parseUpstreamResponse, resolveApiBaseUrl } from "../../../shared";

type ParamsRecord = Record<string, string | string[] | undefined>;

export async function GET(
  request: Request,
  context: { params: Promise<ParamsRecord> },
) {
  const rawParams = ((await context.params) ?? {}) as ParamsRecord;
  const planIdValue = rawParams?.planId;
  const planId = Array.isArray(planIdValue) ? planIdValue[0]?.trim() : planIdValue?.trim();

  if (!planId) {
    return NextResponse.json(
      {
        error: "invalid_plan",
        message: "Plan identifier must be provided in the route.",
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
    const requestUrl = new URL(request.url);
    const upstreamUrl = new URL(`/audit/plan/${encodeURIComponent(planId)}`, baseUrl);
    if (requestUrl.search) {
      upstreamUrl.search = requestUrl.search;
    }

    const upstreamResponse = await fetch(
      upstreamUrl,
      {
        method: "GET",
        headers: {
          accept: "application/json",
        },
        cache: "no-store",
      },
    );

    const payload = await parseUpstreamResponse(upstreamResponse);
    return NextResponse.json(payload, { status: upstreamResponse.status });
  } catch (error) {
    return NextResponse.json(
      {
        error: "upstream_unavailable",
        message: "Unable to reach the audit service.",
      },
      { status: 502 },
    );
  }
}
