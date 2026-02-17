import { NextResponse } from "next/server";
import { listIntegrations } from "../../local-store";

export async function GET() {
  return NextResponse.json(listIntegrations(), { status: 200 });
}
