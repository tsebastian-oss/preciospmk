import { NextRequest, NextResponse } from "next/server";
import { brandScopeAllows, enterpriseAccess } from "@/lib/enterprise-auth";

const SUPABASE_URL = process.env.SUPABASE_URL
  ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  ?? "https://yfpixszkiakwzrqdcfbw.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY
  ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ?? process.env.SUPABASE_PUBLISHABLE_KEY
  ?? "sb_publishable_4FrGlw8owGm5EtwMs9V5zQ_oBrH0c0-";

function headers(token: string) {
  return { apikey: SUPABASE_KEY, authorization: `Bearer ${token}`, "content-type":"application/json" };
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request,"brand-panel");
  if (authorization.response) return authorization.response;
  if (!authorization.access || !brandScopeAllows(authorization.access,"bodegas-don-luis")) {
    return NextResponse.json({ error:"Esta marca no está habilitada para tu cuenta." },{ status:403 });
  }

  const token = request.cookies.get("mgp_access_token")?.value;
  if (!token) return NextResponse.json({ error:"No autorizado" },{ status:401 });

  const organizationId = authorization.access.organizationId;
  const conversationId = request.nextUrl.searchParams.get("id");

  try {
    if (conversationId) {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/brand_ai_messages?conversation_id=eq.${encodeURIComponent(conversationId)}&organization_id=eq.${encodeURIComponent(organizationId)}&select=id,role,content,created_at&order=created_at.asc,id.asc`,
        { headers:headers(token), cache:"no-store", signal:AbortSignal.timeout(10000) },
      );
      const data = await readJson(response);
      if (!response.ok) return NextResponse.json({ error:data?.message || "No fue posible cargar la conversación." },{ status:response.status });
      return NextResponse.json({ messages:Array.isArray(data) ? data : [] });
    }

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/brand_ai_conversations?organization_id=eq.${encodeURIComponent(organizationId)}&conversation_type=eq.peru-liquor&select=id,title,created_at,updated_at&order=updated_at.desc&limit=60`,
      { headers:headers(token), cache:"no-store", signal:AbortSignal.timeout(10000) },
    );
    const data = await readJson(response);
    if (!response.ok) return NextResponse.json({ error:data?.message || "No fue posible cargar el historial." },{ status:response.status });
    return NextResponse.json({ conversations:Array.isArray(data) ? data : [] });
  } catch (cause) {
    return NextResponse.json({ error:cause instanceof Error ? cause.message : "No fue posible cargar el historial." },{ status:500 });
  }
}
