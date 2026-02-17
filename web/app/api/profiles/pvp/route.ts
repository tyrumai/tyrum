import { NextRequest, NextResponse } from "next/server";
import { savePvpProfile } from "../../local-store";

async function readJsonBody(request: NextRequest) {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export async function PUT(request: NextRequest) {
  const body = await readJsonBody(request);
  if (
    !body ||
    typeof body !== "object" ||
    typeof (body as any).profile !== "object" ||
    Array.isArray((body as any).profile)
  ) {
    return NextResponse.json(
      {
        error: "invalid_payload",
        message: "Body must include a 'profile' object.",
      },
      { status: 400 },
    );
  }

  const saved = savePvpProfile((body as { profile: Record<string, unknown> }).profile);
  return NextResponse.json(
    {
      status: "updated",
      profile: saved.profile,
      version: saved.version,
    },
    { status: 200 },
  );
}
