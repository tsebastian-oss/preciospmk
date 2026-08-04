import { NextResponse } from "next/server";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const CRAWL_START_ENDPOINT =
  "https://yfpixszkiakwzrqdcfbw.supabase.co/functions/v1/catalog-crawl-start";

export async function GET() {
  try {
    const response = await fetch(CRAWL_START_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });

    const text = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text || "Invalid response from catalog crawler" };
    }

    return NextResponse.json(payload, {
      status: response.status,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
