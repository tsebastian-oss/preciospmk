import { NextRequest, NextResponse } from "next/server";
import { brandScopeAllows, enterpriseAccess } from "@/lib/enterprise-auth";

const SUPABASE_URL = process.env.SUPABASE_URL
  ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  ?? "https://yfpixszkiakwzrqdcfbw.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY
  ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ?? process.env.SUPABASE_PUBLISHABLE_KEY
  ?? "sb_publishable_4FrGlw8owGm5EtwMs9V5zQ_oBrH0c0-";

const CONVERSATION_TYPE = "piwen-pricing";

function headers(token: string) {
  return {
    apikey: SUPABASE_KEY,
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function authorize(request: NextRequest): Promise<{ response?: NextResponse; token?: string; organizationId?: string }> {
  const authorization = await enterpriseAccess(request, "brand-panel");
  if (authorization.response) return { response: authorization.response as NextResponse };
  if (!authorization.access || !brandScopeAllows(authorization.access, "piwen")) {
    return { response: NextResponse.json({ error: "Este panel no está habilitado para tu cuenta." }, { status: 403 }) };
  }
  const token = request.cookies.get("mgp_access_token")?.value;
  if (!token) return { response: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  return { token, organizationId: authorization.access.organizationId };
}

export async function GET(request: NextRequest) {
  const auth = await authorize(request);
  if (auth.response) return auth.response;

  const conversationId = request.nextUrl.searchParams.get("id");
  try {
    if (conversationId) {
      const conversationResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/brand_ai_conversations?id=eq.${encodeURIComponent(conversationId)}&organization_id=eq.${encodeURIComponent(auth.organizationId!)}&conversation_type=eq.${CONVERSATION_TYPE}&select=id&limit=1`,
        { headers: headers(auth.token!), cache: "no-store", signal: AbortSignal.timeout(8_000) },
      );
      const conversationData = await readJson(conversationResponse);
      if (!conversationResponse.ok || !Array.isArray(conversationData) || !conversationData[0]?.id) {
        return NextResponse.json({ error: "La conversación no existe o no pertenece al Copilot de Piwén." }, { status: 404 });
      }

      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/brand_ai_messages?conversation_id=eq.${encodeURIComponent(conversationId)}&organization_id=eq.${encodeURIComponent(auth.organizationId!)}&select=id,role,content,payload,created_at&order=created_at.asc,id.asc`,
        { headers: headers(auth.token!), cache: "no-store", signal: AbortSignal.timeout(8_000) },
      );
      const data = await readJson(response);
      if (!response.ok) {
        return NextResponse.json({ error: data?.message || "No fue posible cargar la conversación." }, { status: response.status });
      }
      return NextResponse.json({ messages: Array.isArray(data) ? data : [] }, { headers: { "cache-control": "private, no-store" } });
    }

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/brand_ai_conversations?organization_id=eq.${encodeURIComponent(auth.organizationId!)}&conversation_type=eq.${CONVERSATION_TYPE}&select=id,title,created_at,updated_at&order=updated_at.desc&limit=40`,
      { headers: headers(auth.token!), cache: "no-store", signal: AbortSignal.timeout(8_000) },
    );
    const data = await readJson(response);
    if (!response.ok) {
      return NextResponse.json({ error: data?.message || "No fue posible cargar el historial." }, { status: response.status });
    }
    return NextResponse.json({ conversations: Array.isArray(data) ? data : [] }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible cargar el historial." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await authorize(request);
  if (auth.response) return auth.response;

  const conversationId = request.nextUrl.searchParams.get("id");
  if (!conversationId) return NextResponse.json({ error: "Falta la conversación." }, { status: 400 });

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/brand_ai_conversations?id=eq.${encodeURIComponent(conversationId)}&organization_id=eq.${encodeURIComponent(auth.organizationId!)}&conversation_type=eq.${CONVERSATION_TYPE}`,
      {
        method: "DELETE",
        headers: headers(auth.token!),
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      },
    );
    const data = await readJson(response);
    if (!response.ok) {
      return NextResponse.json({ error: data?.message || "No fue posible eliminar la conversación." }, { status: response.status });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No fue posible eliminar la conversación." },
      { status: 500 },
    );
  }
}
