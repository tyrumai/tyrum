import { NextResponse } from "next/server";
import { previewVoice } from "../../../local-store";

export async function POST() {
  return NextResponse.json(previewVoice(), { status: 200 });
}
