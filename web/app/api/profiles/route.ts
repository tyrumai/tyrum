import { NextResponse } from "next/server";
import { readProfiles } from "../local-store";

export async function GET() {
  return NextResponse.json(readProfiles(), { status: 200 });
}
