import { NextRequest, NextResponse } from "next/server";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://yfpixszkiakwzrqdcfbw.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_4FrGlw8owGm5EtwMs9V5zQ_oBrH0c0-";

async function rpc(request: NextRequest, name: string, body: Record<string, unknown> = {}) {
  const token = request.cookies.get("mgp_access_token")?.value;
  if (!token) return { response: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) {
    const status = response.status === 400 || response.status === 403 ? 403 : response.status;
    return { response: NextResponse.json({ error: status === 403 ? "Acceso exclusivo para administradores" : text }, { status }) };
  }
  return { data: text ? JSON.parse(text) : null };
}

export async function GET(request: NextRequest) {
  const result = await rpc(request, "admin_ai_status");
  if (result.response) return result.response;
  return NextResponse.json(result.data);
}

export async function POST(request: NextRequest) {
  const payload = await request.json() as { apiKey?: string; model?: string; enabled?: boolean };
  const result = await rpc(request, "admin_set_ai_config", {
    p_api_key: payload.apiKey?.trim() || null,
    p_model: payload.model?.trim() || "gpt-5-mini",
    p_enabled: Boolean(payload.enabled),
  });
  if (result.response) return result.response;
  return NextResponse.json(result.data);
}
