import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ADMIN_TOKEN = "mgp-vercel-stabilize-2026-08-06";
const SUPABASE_STABILIZER = "https://yfpixszkiakwzrqdcfbw.supabase.co/functions/v1/scraping-cron-stabilizer?token=mgp-stabilize-2026-08-06";

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("token") !== ADMIN_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const response = await fetch(SUPABASE_STABILIZER, {
    method: "GET",
    cache: "no-store",
  });
  const body = await response.text();
  return new NextResponse(body, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
  });
}
