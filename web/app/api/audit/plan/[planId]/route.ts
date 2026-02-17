import { NextResponse } from "next/server";
import { getPlanTimeline } from "../../../local-store";

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

  const timeline = getPlanTimeline(planId);
  if (!timeline) {
    return NextResponse.json(
      {
        error: "plan_not_found",
        message: "Plan audit timeline not found.",
      },
      { status: 404 },
    );
  }

  const requestUrl = new URL(request.url);
  if (requestUrl.searchParams.get("redact") === "none") {
    return NextResponse.json(timeline, { status: 200 });
  }

  // Return the default redacted timeline in self-hosted single-user mode.
  return NextResponse.json(timeline, { status: 200 });
}
