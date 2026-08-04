import { NextResponse } from "next/server";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const SCRAPER_ENDPOINT = "https://yfpixszkiakwzrqdcfbw.supabase.co/functions/v1/scrape-supermarkets";

export async function GET() {
  const oidcToken = process.env.VERCEL_OIDC_TOKEN;
  if (!oidcToken) {
    return NextResponse.json(
      { error: "Vercel OIDC is not available for this deployment" },
      { status: 503 }
    );
  }

  try {
    const response = await fetch(SCRAPER_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${oidcToken}`,
        "content-type": "application/json"
      },
      body: "{}",
      cache: "no-store",
      signal: AbortSignal.timeout(55_000)
    });

    const text = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text || "Invalid response from scraper" };
    }

    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
