import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess } from "@/lib/enterprise-auth";
import {
  openAiIntelligenceConfigured,
  runOpenAiIntelligenceAgent,
  type IntelligenceChatMessage,
  type IntelligenceFilters,
} from "@/lib/openai-intelligence";

const SUPABASE_URL = process.env.SUPABASE_URL
  ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  ?? "https://yfpixszkiakwzrqdcfbw.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY
  ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ?? process.env.SUPABASE_PUBLISHABLE_KEY
  ?? "sb_publishable_4FrGlw8owGm5EtwMs9V5zQ_oBrH0c0-";

function restHeaders(token: string, extra: Record<string, string> = {}) {
  return { apikey: SUPABASE_KEY, authorization: `Bearer ${token}`, "content-type": "application/json", ...extra };
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function conversationTitle(question: string) {
  const clean = question.replace(/\s+/g, " ").trim();
  return clean.length <= 62 ? clean : `${clean.slice(0, 59).trimEnd()}…`;
}

function isDataTimeout(value: unknown) {
  const text = (value instanceof Error ? value.message : String(value ?? "")).toLowerCase();
  return text.includes("57014")
    || text.includes("statement timeout")
    || text.includes("canceling statement")
    || text.includes("query_canceled")
    || text.includes("query canceled")
    || text.includes("timed out")
    || text.includes("timeout")
    || text.includes("aborterror");
}

function safeFailure(value: unknown, fallback: string) {
  if (isDataTimeout(value)) return "El análisis está tardando más de lo habitual. Intenta nuevamente en unos segundos.";
  const message = value instanceof Error ? value.message : String(value ?? "");
  if (/postgres|supabase|sqlstate|pgrst|57014|canceling statement/i.test(message)) return fallback;
  return message || fallback;
}

function cleanMessages(value: unknown): IntelligenceChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item: any) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
    .map((item: any) => ({
      role: item.role as "user" | "assistant",
      content: item.content.trim().slice(0, 4_000),
      brand: typeof item.brand === "string" ? item.brand.slice(0, 120) : null,
    }))
    .filter((item) => item.content.length > 0)
    .slice(-14);
}

function cleanFilters(value: unknown): IntelligenceFilters {
  const filters = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const retailerType = typeof filters.retailerType === "string" ? filters.retailerType : "all";
  const stock = typeof filters.stock === "string" ? filters.stock : "all";
  return {
    retailerType: ["all", "supermarket", "department_store", "pharmacy", "home_improvement"].includes(retailerType) ? retailerType : "all",
    supermarket: typeof filters.supermarket === "string" ? filters.supermarket.trim().slice(0, 100) : "",
    category: typeof filters.category === "string" ? filters.category.trim().slice(0, 180) : "",
    brand: typeof filters.brand === "string" ? filters.brand.trim().slice(0, 120) : "",
    query: typeof filters.query === "string" ? filters.query.trim().slice(0, 180) : "",
    stock: ["all", "in", "out"].includes(stock) ? stock : "all",
    period: Math.max(7, Math.min(365, Number(filters.period) || 30)),
  };
}

async function createConversation(token: string, organizationId: string, question: string) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/brand_ai_conversations?select=id,title`, {
    method: "POST",
    headers: restHeaders(token, { Prefer: "return=representation" }),
    body: JSON.stringify({ organization_id: organizationId, title: conversationTitle(question), conversation_type: "brand" }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const data = await readJson(response);
  if (!response.ok || !Array.isArray(data) || !data[0]?.id) {
    throw new Error(safeFailure(data?.message, "No fue posible crear la conversación."));
  }
  return { id: String(data[0].id), title: String(data[0].title || conversationTitle(question)) };
}

async function saveMessage(
  token: string,
  organizationId: string,
  conversationId: string,
  message: { role: "user" | "assistant"; content: string; brand?: string | null; ai?: boolean; payload?: unknown },
) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/brand_ai_messages`, {
    method: "POST",
    headers: restHeaders(token),
    body: JSON.stringify({
      conversation_id: conversationId,
      organization_id: organizationId,
      role: message.role,
      content: message.content,
      brand: message.brand ?? null,
      ai: message.ai ?? null,
      payload: message.payload ?? {},
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const data = await readJson(response);
    throw new Error(safeFailure(data?.message, "No fue posible guardar el mensaje."));
  }
}

async function touchConversation(token: string, organizationId: string, conversationId: string, brand?: string | null) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/brand_ai_conversations?id=eq.${encodeURIComponent(conversationId)}&organization_id=eq.${encodeURIComponent(organizationId)}&conversation_type=eq.brand`,
    {
      method: "PATCH",
      headers: restHeaders(token),
      body: JSON.stringify({ updated_at: new Date().toISOString(), last_brand: brand ?? null }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) {
    const data = await readJson(response);
    throw new Error(safeFailure(data?.message, "No fue posible actualizar la conversación."));
  }
}

async function legacySupabaseAgent(
  token: string,
  organizationId: string,
  messages: IntelligenceChatMessage[],
  filters: IntelligenceFilters,
) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/brand-intelligence-chat-v2`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ organizationId, messages, filters }),
    cache: "no-store",
    signal: AbortSignal.timeout(120_000),
  });
  const data = await readJson(response) ?? {};
  if (!response.ok && isDataTimeout(data?.error)) {
    return {
      status: 503,
      data: {
        error: "El análisis está tardando más de lo habitual. Intenta nuevamente en unos segundos.",
        code: "DATA_TIMEOUT",
        transient: true,
      },
    };
  }
  if (!response.ok && data?.error) data.error = safeFailure(data.error, "No fue posible consultar MGP Intelligence en este momento.");
  return {
    status: response.status,
    data: {
      ...data,
      dataSource: data?.dataSource ?? "supabase",
      agentRuntime: "legacy_supabase",
    },
  };
}

export async function POST(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "brand-intelligence");
  if (authorization.response) return authorization.response;

  const token = request.cookies.get("mgp_access_token")?.value;
  if (!token) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const body = await request.json();
    const messages = cleanMessages(body?.messages);
    const filters = cleanFilters(body?.filters);
    const lastUser = [...messages].reverse().find((item) => item.role === "user")?.content?.trim();
    if (!lastUser) return NextResponse.json({ error: "Falta la pregunta." }, { status: 400 });

    const access = authorization.access!;
    const organizationId = access.organizationId;
    let conversationId = typeof body?.conversationId === "string" && body.conversationId ? body.conversationId : "";
    let title: string | undefined;

    if (!conversationId) {
      const conversation = await createConversation(token, organizationId, lastUser);
      conversationId = conversation.id;
      title = conversation.title;
    }

    await saveMessage(token, organizationId, conversationId, { role: "user", content: lastUser });

    let data: Record<string, any>;
    let status = 200;

    if (openAiIntelligenceConfigured()) {
      try {
        data = await runOpenAiIntelligenceAgent(messages, filters, access);
        data.agentRuntime = "openai_clickhouse";
      } catch (error) {
        console.warn("OpenAI ClickHouse Intelligence failed; falling back to the existing Supabase agent.", {
          name: error instanceof Error ? error.name : "unknown",
          status: Number((error as { status?: number })?.status || 0) || undefined,
        });
        const legacy = await legacySupabaseAgent(token, organizationId, messages, filters);
        data = { ...legacy.data, agentFallback: true };
        status = legacy.status;
      }
    } else {
      const legacy = await legacySupabaseAgent(token, organizationId, messages, filters);
      data = legacy.data;
      status = legacy.status;
    }

    if (status >= 400 || !data?.answer) {
      return NextResponse.json({ ...data, conversationId, conversationTitle: title }, { status });
    }

    await saveMessage(token, organizationId, conversationId, {
      role: "assistant",
      content: String(data.answer),
      brand: data.brand ?? null,
      ai: data.ai,
      payload: {
        analysis: data.analysis ?? null,
        summary: data.data?.current?.summary ?? null,
        sources: Array.isArray(data.data?.priceMatches) ? data.data.priceMatches.slice(0, 6) : [],
        model: data.model ?? null,
        analysisMode: data.analysisMode ?? null,
        reasoningEffort: data.reasoningEffort ?? null,
        toolsUsed: Array.isArray(data.toolsUsed) ? data.toolsUsed : [],
        dataSource: data.dataSource ?? null,
        agentRuntime: data.agentRuntime ?? null,
      },
    });
    await touchConversation(token, organizationId, conversationId, data.brand ?? null);

    return NextResponse.json({ ...data, conversationId, conversationTitle: title }, { status });
  } catch (error) {
    const transient = isDataTimeout(error);
    return NextResponse.json(
      transient
        ? { error: "El análisis está tardando más de lo habitual. Intenta nuevamente en unos segundos.", code: "DATA_TIMEOUT", transient: true }
        : { error: safeFailure(error, "No fue posible consultar MGP Intelligence.") },
      { status: transient ? 503 : 500 },
    );
  }
}
