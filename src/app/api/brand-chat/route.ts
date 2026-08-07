import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess } from "@/lib/enterprise-auth";

const SUPABASE_URL = process.env.SUPABASE_URL
  ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  ?? "https://yfpixszkiakwzrqdcfbw.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY
  ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ?? process.env.SUPABASE_PUBLISHABLE_KEY
  ?? "sb_publishable_4FrGlw8owGm5EtwMs9V5zQ_oBrH0c0-";

function restHeaders(token: string, extra: Record<string, string> = {}) { return { apikey: SUPABASE_KEY, authorization: `Bearer ${token}`, "content-type": "application/json", ...extra }; }
async function readJson(response: Response) { const text = await response.text(); if (!text) return null; try { return JSON.parse(text); } catch { return null; } }
function conversationTitle(question: string) { const clean = question.replace(/\s+/g, " ").trim(); return clean.length <= 62 ? clean : `${clean.slice(0, 59).trimEnd()}…`; }

async function createConversation(token: string, organizationId: string, question: string) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/brand_ai_conversations?select=id,title`, {
    method: "POST", headers: restHeaders(token, { Prefer: "return=representation" }),
    body: JSON.stringify({ organization_id: organizationId, title: conversationTitle(question), conversation_type: "brand" }), cache: "no-store", signal: AbortSignal.timeout(8_000),
  });
  const data = await readJson(response);
  if (!response.ok || !Array.isArray(data) || !data[0]?.id) throw new Error(data?.message || "No fue posible crear la conversación.");
  return { id: String(data[0].id), title: String(data[0].title || conversationTitle(question)) };
}
async function saveMessage(token: string, organizationId: string, conversationId: string, message: { role: "user" | "assistant"; content: string; brand?: string | null; ai?: boolean; payload?: unknown }) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/brand_ai_messages`, { method: "POST", headers: restHeaders(token), body: JSON.stringify({ conversation_id: conversationId, organization_id: organizationId, role: message.role, content: message.content, brand: message.brand ?? null, ai: message.ai ?? null, payload: message.payload ?? {} }), cache: "no-store", signal: AbortSignal.timeout(8_000) });
  if (!response.ok) { const data = await readJson(response); throw new Error(data?.message || "No fue posible guardar el mensaje."); }
}
async function touchConversation(token: string, organizationId: string, conversationId: string, brand?: string | null) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/brand_ai_conversations?id=eq.${encodeURIComponent(conversationId)}&organization_id=eq.${encodeURIComponent(organizationId)}&conversation_type=eq.brand`, { method: "PATCH", headers: restHeaders(token), body: JSON.stringify({ updated_at: new Date().toISOString(), last_brand: brand ?? null }), cache: "no-store", signal: AbortSignal.timeout(8_000) });
  if (!response.ok) { const data = await readJson(response); throw new Error(data?.message || "No fue posible actualizar la conversación."); }
}

export async function POST(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "pricing");
  if (authorization.response) return authorization.response;
  const token = request.cookies.get("mgp_access_token")?.value;
  if (!token) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    const body = await request.json();
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const lastUser = [...messages].reverse().find((item: any) => item?.role === "user" && typeof item?.content === "string")?.content?.trim();
    if (!lastUser) return NextResponse.json({ error: "Falta la pregunta." }, { status: 400 });
    const organizationId = authorization.access!.organizationId;
    let conversationId = typeof body?.conversationId === "string" && body.conversationId ? body.conversationId : "";
    let title: string | undefined;
    if (!conversationId) { const conversation = await createConversation(token, organizationId, lastUser); conversationId = conversation.id; title = conversation.title; }
    await saveMessage(token, organizationId, conversationId, { role: "user", content: lastUser });
    const response = await fetch(`${SUPABASE_URL}/functions/v1/brand-intelligence-chat`, { method: "POST", headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ organizationId, messages, filters: body?.filters ?? {} }), cache: "no-store", signal: AbortSignal.timeout(25_000) });
    const data = await readJson(response) ?? {};
    if (response.ok && data?.answer) {
      await saveMessage(token, organizationId, conversationId, { role: "assistant", content: String(data.answer), brand: data.brand ?? null, ai: data.ai, payload: { analysis: data.analysis ?? null, summary: data.data?.current?.summary ?? null, model: data.model ?? null } });
      await touchConversation(token, organizationId, conversationId, data.brand ?? null);
    }
    return NextResponse.json({ ...data, conversationId, conversationTitle: title }, { status: response.status });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") return NextResponse.json({ error: "El análisis está tomando más tiempo de lo esperado. Intenta nuevamente." }, { status: 504 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible consultar el analista de marca." }, { status: 500 });
  }
}
