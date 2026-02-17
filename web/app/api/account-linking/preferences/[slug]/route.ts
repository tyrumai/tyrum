import { NextRequest, NextResponse } from "next/server";
import { setIntegrationPreference } from "../../../local-store";

async function readJsonBody(request: NextRequest) {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> },
) {
  const resolvedParams = (await context.params) ?? {};
  const slugValue = resolvedParams?.slug;
  const slug = Array.isArray(slugValue) ? slugValue[0]?.trim() : slugValue?.trim();
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

  const integration = setIntegrationPreference(slug, body.enabled);
  if (!integration) {
    return NextResponse.json(
      {
        error: "not_found",
        message: `No integration preference registered for slug '${slug}'.`,
      },
      { status: 404 },
    );
  }

  return NextResponse.json(
    {
      status: "updated",
      integration,
    },
    { status: 200 },
  );
}
