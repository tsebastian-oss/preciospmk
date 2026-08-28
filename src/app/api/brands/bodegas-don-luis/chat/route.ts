import { NextRequest, NextResponse } from "next/server";
import { brandScopeAllows, enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";

const SUPABASE_URL = process.env.SUPABASE_URL
  ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  ?? "https://yfpixszkiakwzrqdcfbw.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY
  ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ?? process.env.SUPABASE_PUBLISHABLE_KEY
  ?? "sb_publishable_4FrGlw8owGm5EtwMs9V5zQ_oBrH0c0-";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";
const OPENAI_MODEL = (process.env.OPENAI_MODEL ?? "gpt-5.1").trim();
const OPENAI_URL = "https://api.openai.com/v1/responses";

type Message = { role: "user" | "assistant"; content: string };
type OpenAIResponse = { model?: string; output?: any[]; incomplete_details?: { reason?: string } | null; error?: { message?: string } | null };

const tools = [
  {
    type: "function",
    name: "get_chain_matrix",
    description: "Devuelve la matriz vigente de precio promedio por cadena para Pisco, Ron y Vino, con SKU, mínimos, máximos y promociones.",
    strict: true,
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    type: "function",
    name: "search_catalog",
    description: "Busca productos, marcas y formatos vigentes en la base censada de Pisco, Ron y Vino. Úsala para marcas concretas, SKUs, formatos, promociones o para encontrar los productos más baratos.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        query: { type: ["string","null"], description: "Marca, producto o formato. Usa null para una consulta general." },
        category: { type: ["string","null"], enum: ["Pisco","Ron","Vino",null] },
        retailer: { type: ["string","null"], description: "Cadena: Tottus, Metro, Wong, Vivanda o Plaza Vea / Makro." },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
      required: ["query","category","retailer","limit"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_price_history",
    description: "Obtiene el histórico agregado de precios por fecha, cadena, categoría y marca. Úsala cuando el usuario pregunte por evolución, cambios, tendencia o comparación temporal.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        category: { type: ["string","null"], enum: ["Pisco","Ron","Vino",null] },
        brand: { type: ["string","null"] },
        retailer: { type: ["string","null"] },
        days: { type: "integer", minimum: 1, maximum: 365 },
      },
      required: ["category","brand","retailer","days"],
      additionalProperties: false,
    },
  },
];

function restHeaders(token: string, extra: Record<string,string> = {}) {
  return { apikey: SUPABASE_KEY, authorization: `Bearer ${token}`, "content-type": "application/json", ...extra };
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function cleanMessages(value: unknown): Message[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item: any) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
    .map((item: any) => ({ role: item.role as "user" | "assistant", content: item.content.trim().slice(0,4000) }))
    .filter(item => item.content.length > 0)
    .slice(-14);
}

function title(question: string) {
  const clean = question.replace(/\s+/g," ").trim();
  return clean.length <= 64 ? clean : clean.slice(0,61).trimEnd() + "…";
}

async function createConversation(token: string, organizationId: string, question: string) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/brand_ai_conversations?select=id,title`, {
    method: "POST",
    headers: restHeaders(token,{ Prefer: "return=representation" }),
    body: JSON.stringify({ organization_id: organizationId, title: title(question), conversation_type: "peru-liquor" }),
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  const data = await readJson(response);
  if (!response.ok || !Array.isArray(data) || !data[0]?.id) throw new Error("No fue posible crear la conversación.");
  return { id: String(data[0].id), title: String(data[0].title || title(question)) };
}

async function saveMessage(token: string, organizationId: string, conversationId: string, message: { role:"user"|"assistant"; content:string; payload?:unknown }) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/brand_ai_messages`, {
    method:"POST",
    headers:restHeaders(token),
    body:JSON.stringify({
      conversation_id:conversationId,
      organization_id:organizationId,
      role:message.role,
      content:message.content,
      brand:"Bodegas Don Luis",
      ai:message.role === "assistant" ? true : null,
      payload:message.payload ?? {},
    }),
    cache:"no-store",
    signal:AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error("No fue posible guardar el mensaje.");
}

async function touchConversation(token: string, organizationId: string, conversationId: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/brand_ai_conversations?id=eq.${encodeURIComponent(conversationId)}&organization_id=eq.${encodeURIComponent(organizationId)}&conversation_type=eq.peru-liquor`, {
    method:"PATCH",
    headers:restHeaders(token),
    body:JSON.stringify({ updated_at:new Date().toISOString(), last_brand:"Bodegas Don Luis" }),
    cache:"no-store",
    signal:AbortSignal.timeout(12000),
  });
}

function instructions() {
  return `Eres MGP Pricing Intelligence para Bodegas Don Luis en Perú.

ALCANCE ESTRICTO:
- Solo puedes responder sobre Pisco, Ron y Vino usando la base censada de Super Precios para Perú.
- Las cadenas monitoreadas son Tottus Perú, Metro Perú, Wong, Vivanda y Plaza Vea / Makro.
- Puedes analizar cualquier marca presente en esas tres categorías, no solo las marcas de Bodegas Don Luis.
- Si el usuario pregunta por otra categoría o por un tema ajeno a pricing/mercado de Pisco, Ron o Vino, responde brevemente que este chat está limitado a esas categorías.
- Nunca inventes precios, SKU, promociones, disponibilidad, tendencias ni cobertura. Toda afirmación cuantitativa debe venir de una herramienta en esta misma respuesta.
- Para comparar cadenas usa get_chain_matrix.
- Para marcas, productos, formatos, precios mínimos, promociones o disponibilidad usa search_catalog.
- Para evolución o cambios en el tiempo usa get_price_history.
- El precio promedio de la matriz es promedio del precio vigente por SKU dentro del surtido de cada cadena. Puede variar por mix; menciona el número de SKU si es relevante.
- Distingue precio de envase/producto de precio por litro. No los mezcles.
- Si el histórico todavía tiene pocos días, dilo claramente.
- Responde en español, con lenguaje ejecutivo y directo. Prioriza la respuesta concreta y luego explica la evidencia necesaria.
- En preguntas de seguimiento usa el contexto de la conversación y no obligues a repetir marca/categoría si ya está clara.`;
}

function outputText(response: OpenAIResponse) {
  return (response.output ?? [])
    .filter(item => item?.type === "message")
    .flatMap(item => Array.isArray(item?.content) ? item.content : [])
    .filter(item => item?.type === "output_text" && typeof item?.text === "string")
    .map(item => item.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function safeArgs(value: unknown) {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string,unknown> : {};
  } catch { return {}; }
}

function compact(value: unknown) {
  const text = JSON.stringify(value);
  return text.length <= 30000 ? text : JSON.stringify({ truncated:true, preview:text.slice(0,29500) });
}

async function openAi(input: any[], allowTools = true): Promise<OpenAIResponse> {
  if (!OPENAI_API_KEY) throw new Error("El chat IA no está configurado.");
  const body: Record<string,unknown> = {
    model: OPENAI_MODEL,
    instructions: allowTools ? instructions() : instructions() + "\nYa tienes la evidencia. No solicites más herramientas y responde ahora.",
    input,
    store:false,
    max_output_tokens:3500,
  };
  if (allowTools) {
    body.tools = tools;
    body.tool_choice = "auto";
    body.parallel_tool_calls = true;
  }
  const response = await fetch(OPENAI_URL, {
    method:"POST",
    headers:{ authorization:`Bearer ${OPENAI_API_KEY}`, "content-type":"application/json" },
    body:JSON.stringify(body),
    cache:"no-store",
    signal:AbortSignal.timeout(60000),
  });
  const data = await readJson(response) as OpenAIResponse | null;
  if (!response.ok) throw new Error(data?.error?.message || "OpenAI no respondió correctamente.");
  return data ?? {};
}

async function executeTool(request: NextRequest, name: string, args: Record<string,unknown>) {
  if (name === "get_chain_matrix") {
    const result = await enterpriseRpc<Record<string,unknown>>(request,"brands_peru_liquor_matrix",{ p_slug:"bodegas-don-luis" });
    return result.response ? { error:"matrix_unavailable" } : result.data;
  }
  if (name === "search_catalog") {
    const category = ["Pisco","Ron","Vino"].includes(String(args.category || "")) ? String(args.category) : null;
    const result = await enterpriseRpc<Record<string,unknown>>(request,"brands_peru_liquor_search",{
      p_slug:"bodegas-don-luis",
      p_query:typeof args.query === "string" ? args.query.slice(0,160) : null,
      p_category:category,
      p_retailer:typeof args.retailer === "string" ? args.retailer.slice(0,120) : null,
      p_limit:Math.max(1,Math.min(100,Number(args.limit)||50)),
    });
    return result.response ? { error:"search_unavailable" } : result.data;
  }
  if (name === "get_price_history") {
    const category = ["Pisco","Ron","Vino"].includes(String(args.category || "")) ? String(args.category) : null;
    const result = await enterpriseRpc<Record<string,unknown>>(request,"brands_peru_liquor_history",{
      p_slug:"bodegas-don-luis",
      p_category:category,
      p_brand:typeof args.brand === "string" ? args.brand.slice(0,120) : null,
      p_retailer:typeof args.retailer === "string" ? args.retailer.slice(0,120) : null,
      p_days:Math.max(1,Math.min(365,Number(args.days)||30)),
    });
    return result.response ? { error:"history_unavailable" } : result.data;
  }
  return { error:"tool_not_allowed" };
}

async function runAgent(request: NextRequest, messages: Message[]) {
  let input: any[] = messages;
  const used: string[] = [];

  for (let round=0; round<4; round++) {
    const response = await openAi(input,true);
    const calls = (response.output ?? []).filter(item => item?.type === "function_call").slice(0,4);
    if (!calls.length) {
      const answer = outputText(response);
      if (!answer) throw new Error(response.incomplete_details?.reason || "El asistente no generó una respuesta.");
      return { answer, model:response.model || OPENAI_MODEL, toolsUsed:[...new Set(used)] };
    }

    const outputs: any[] = [];
    for (const call of calls) {
      const name = String(call?.name || "");
      used.push(name);
      const data = await executeTool(request,name,safeArgs(call?.arguments));
      outputs.push({ type:"function_call_output", call_id:String(call?.call_id || ""), output:compact(data) });
    }
    input = [...input, ...(response.output ?? []), ...outputs];
  }

  const final = await openAi(input,false);
  const answer = outputText(final);
  if (!answer) throw new Error("El asistente no generó una respuesta final.");
  return { answer, model:final.model || OPENAI_MODEL, toolsUsed:[...new Set(used)] };
}

export async function POST(request: NextRequest) {
  const authorization = await enterpriseAccess(request,"brand-panel");
  if (authorization.response) return authorization.response;
  if (!authorization.access || !brandScopeAllows(authorization.access,"bodegas-don-luis")) {
    return NextResponse.json({ error:"Esta marca no está habilitada para tu cuenta." },{ status:403 });
  }

  const token = request.cookies.get("mgp_access_token")?.value;
  if (!token) return NextResponse.json({ error:"No autorizado" },{ status:401 });

  try {
    const body = await request.json();
    const messages = cleanMessages(body?.messages);
    const lastUser = [...messages].reverse().find(item => item.role === "user")?.content;
    if (!lastUser) return NextResponse.json({ error:"Falta la pregunta." },{ status:400 });

    const organizationId = authorization.access.organizationId;
    let conversationId = typeof body?.conversationId === "string" ? body.conversationId : "";
    let conversationTitle: string | undefined;
    if (!conversationId) {
      const conversation = await createConversation(token,organizationId,lastUser);
      conversationId = conversation.id;
      conversationTitle = conversation.title;
    }

    await saveMessage(token,organizationId,conversationId,{ role:"user", content:lastUser });
    const result = await runAgent(request,messages);
    await saveMessage(token,organizationId,conversationId,{
      role:"assistant",
      content:result.answer,
      payload:{ model:result.model, toolsUsed:result.toolsUsed, scope:["Pisco","Ron","Vino"], market:"Perú" },
    });
    await touchConversation(token,organizationId,conversationId);

    return NextResponse.json({ ...result, conversationId, conversationTitle, ai:true });
  } catch (cause) {
    return NextResponse.json({ error:cause instanceof Error ? cause.message : "No fue posible consultar MGP Pricing Intelligence." },{ status:500 });
  }
}
