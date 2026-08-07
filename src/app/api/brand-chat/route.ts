import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess } from "@/lib/enterprise-auth";

const SUPABASE_URL = process.env.SUPABASE_URL
  ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  ?? "https://yfpixszkiakwzrqdcfbw.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY
  ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ?? process.env.SUPABASE_PUBLISHABLE_KEY
  ?? "sb_publishable_4FrGlw8owGm5EtwMs9V5zQ_oBrH0c0-";

export async function POST(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "pricing");
  if (authorization.response) return authorization.response;

  const token = request.cookies.get("mgp_access_token")?.value;
  if (!token) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const body = await request.json();
    const response = await fetch(`${SUPABASE_URL}/functions/v1/brand-intelligence-chat`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        organizationId: authorization.access!.organizationId,
        messages: Array.isArray(body?.messages) ? body.messages : [],
        filters: body?.filters ?? {},
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return NextResponse.json({ error: "El análisis está tomando más tiempo de lo esperado. Intenta nuevamente." }, { status: 504 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible consultar el analista de marca." }, { status: 500 });
  }
}
