import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess } from "@/lib/enterprise-auth";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const CRAWL_START_ENDPOINT =
  "https://yfpixszkiakwzrqdcfbw.supabase.co/functions/v1/catalog-crawl-start";

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "overview");
  if (authorization.response) return authorization.response;
  if (!authorization.access?.isSaasAdmin) {
    return NextResponse.json({ error: "Solo el administrador del SaaS puede iniciar el crawler global." }, { status: 403 });
  }

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
