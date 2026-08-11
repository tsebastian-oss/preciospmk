import type { EnterpriseAccessContext } from "@/lib/enterprise-auth";
import {
  executeIntelligenceTool,
  type IntelligenceToolName,
} from "@/lib/clickhouse-intelligence";
import { clickHouseConfigured } from "@/lib/clickhouse";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";
const OPENAI_MODEL = (process.env.OPENAI_MODEL ?? "gpt-5").trim();
const OPENAI_URL = "https://api.openai.com/v1/responses";

export type IntelligenceChatMessage = {
  role: "user" | "assistant";
  content: string;
  brand?: string | null;
};

export type IntelligenceFilters = {
  retailerType?: string;
  supermarket?: string;
  category?: string;
  brand?: string;
  query?: string;
  stock?: string;
  period?: number;
};

export type IntelligenceAgentResult = {
  answer: string;
  model: string;
  ai: true;
  assistant: "MGP Intelligence";
  responseStyle: "conversational_clickhouse_agent";
  analysisMode: "clickhouse_tools";
  toolsUsed: string[];
  dataSource: "clickhouse";
  brand: string | null;
};

type ResponseItem = Record<string, any>;
type OpenAIResponse = {
  id?: string;
  model?: string;
  output?: ResponseItem[];
  error?: { message?: string } | null;
  incomplete_details?: { reason?: string } | null;
};

const TOOL_NAMES = new Set<IntelligenceToolName>([
  "search_products",
  "get_price_history",
  "compare_retailers",
  "get_brand_snapshot",
  "get_promotions",
  "get_data_inventory",
]);

const tools = [
  {
    type: "function",
    name: "search_products",
    description: "Busca productos reales y su precio/stock vigente. Úsala primero cuando el usuario mencione una presentación, tamaño o variante concreta, o cuando necesites verificar qué SKU coinciden con una descripción.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Texto del producto o presentación a buscar." },
        brand: { type: ["string", "null"] },
        category: { type: ["string", "null"] },
        retailerType: { type: ["string", "null"], enum: ["supermarket", "department_store", "pharmacy", "home_improvement", null] },
        supermarkets: { type: "array", items: { type: "string" }, maxItems: 12 },
        stock: { type: "string", enum: ["all", "in", "out"] },
        limit: { type: "integer", minimum: 1, maximum: 25 },
      },
      required: ["query", "brand", "category", "retailerType", "supermarkets", "stock", "limit"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_price_history",
    description: "Obtiene evolución histórica diaria de precios desde ClickHouse, agrupada por retailer. Devuelve mediana, promedio, mínimo, máximo, SKU y variación por retailer. Úsala para evolución, subidas/bajadas, tendencias o períodos específicos.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        query: { type: ["string", "null"], description: "Producto o presentación concreta; null si el análisis es solo por marca/categoría." },
        brand: { type: ["string", "null"] },
        category: { type: ["string", "null"] },
        retailerType: { type: ["string", "null"], enum: ["supermarket", "department_store", "pharmacy", "home_improvement", null] },
        supermarkets: { type: "array", items: { type: "string" }, maxItems: 12 },
        days: { type: "integer", minimum: 7, maximum: 365 },
      },
      required: ["query", "brand", "category", "retailerType", "supermarkets", "days"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "compare_retailers",
    description: "Compara el estado vigente de un producto, marca o categoría entre retailers: mediana de precio, disponibilidad, promociones y cobertura. Úsala para 'dónde está más barato', 'qué cadena tiene más stock' y comparaciones de cadenas.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        query: { type: ["string", "null"] },
        brand: { type: ["string", "null"] },
        category: { type: ["string", "null"] },
        retailerType: { type: ["string", "null"], enum: ["supermarket", "department_store", "pharmacy", "home_improvement", null] },
        supermarkets: { type: "array", items: { type: "string" }, maxItems: 12 },
      },
      required: ["query", "brand", "category", "retailerType", "supermarkets"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_brand_snapshot",
    description: "Entrega un snapshot vigente de una marca: SKU, retailers, disponibilidad, promociones, mediana/rango de precio, categorías principales y desglose por cadena.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        brand: { type: "string" },
        category: { type: ["string", "null"] },
        retailerType: { type: ["string", "null"], enum: ["supermarket", "department_store", "pharmacy", "home_improvement", null] },
        supermarkets: { type: "array", items: { type: "string" }, maxItems: 12 },
      },
      required: ["brand", "category", "retailerType", "supermarkets"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_promotions",
    description: "Busca ofertas vigentes calculadas a partir de precio regular versus precio oferta y devuelve los productos con mayor descuento. Úsala para promociones, ofertas y actividad promocional.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        query: { type: ["string", "null"] },
        brand: { type: ["string", "null"] },
        category: { type: ["string", "null"] },
        retailerType: { type: ["string", "null"], enum: ["supermarket", "department_store", "pharmacy", "home_improvement", null] },
        supermarkets: { type: "array", items: { type: "string" }, maxItems: 12 },
        limit: { type: "integer", minimum: 1, maximum: 30 },
      },
      required: ["query", "brand", "category", "retailerType", "supermarkets", "limit"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_data_inventory",
    description: "Indica la cobertura real disponible: fechas, días, productos, retailers y última observación. Úsala para saber desde cuándo hay datos, cuánto histórico existe o validar cobertura antes de afirmar que un período no tiene información.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        days: { type: "integer", minimum: 7, maximum: 365 },
      },
      required: ["days"],
      additionalProperties: false,
    },
  },
];

function cleanMessages(value: IntelligenceChatMessage[]) {
  return value
    .filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
    .map((item) => ({ role: item.role, content: item.content.trim().slice(0, 4_000) }))
    .filter((item) => item.content.length > 0)
    .slice(-14);
}

function filterContext(filters: IntelligenceFilters) {
  return {
    retailerType: filters.retailerType || "all",
    supermarket: filters.supermarket || null,
    category: filters.category || null,
    brand: filters.brand || null,
    stock: filters.stock || "all",
    periodDays: Number(filters.period) || 30,
  };
}

function accessContext(access: EnterpriseAccessContext) {
  return {
    organization: access.organizationName,
    retailers: access.retailers,
    brands: access.brands,
    competitors: access.competitors,
    categories: access.categories,
    industrySlug: access.industrySlug,
    industryConfigured: access.industryConfigured,
  };
}

function instructions(access: EnterpriseAccessContext, filters: IntelligenceFilters) {
  return `Eres MGP Intelligence, un analista conversacional de pricing y retail para Chile.

Tu trabajo es conversar de forma natural, como un buen analista humano. No uses siempre el mismo formato ni conviertas cada respuesta en un reporte rígido. Responde en español salvo que el usuario use otro idioma.

REGLAS DE DATOS:
- Toda afirmación cuantitativa sobre precios, stock, promociones, surtido o evolución debe estar respaldada por una herramienta de datos en esta misma respuesta. Nunca inventes valores.
- Las herramientas consultan ClickHouse con datos capturados por MGP y ya aplican el alcance autorizado de la organización.
- No tienes SQL libre. No pidas ni intentes obtener credenciales, tablas internas o consultas SQL.
- Si el usuario pregunta por un producto/presentación concreta (por ejemplo 'Coca-Cola Zero lata 350 ml'), usa search_products antes de sacar conclusiones históricas o comparar cadenas. Si aparecen tamaños o packs distintos, dilo y evita tratarlos como SKU equivalentes.
- Para evolución usa get_price_history. Prefiere la mediana cuando la muestra puede mezclar productos heterogéneos.
- Para 'dónde está más barato' usa compare_retailers y, si el producto es específico, valida antes con search_products.
- Para una visión general de marca usa get_brand_snapshot; para ofertas usa get_promotions.
- Si el período pedido parece no tener datos, usa get_data_inventory antes de concluir que no existe histórico.
- El día actual puede estar parcial mientras los crawlers siguen corriendo. Señálalo solo cuando afecte la interpretación.
- Si no hay evidencia suficiente, dilo claramente y sugiere qué especificación falta (tamaño, pack, retailer, etc.).
- En seguimientos, utiliza el contexto de la conversación; no obligues al usuario a repetir marca/producto si está claro.

FILTROS GLOBALES ACTIVOS (se aplican como restricción cuando tienen valor):
${JSON.stringify(filterContext(filters))}

ALCANCE AUTORIZADO:
${JSON.stringify(accessContext(access))}

Da primero la respuesta que resuelve la pregunta. Explica metodología o limitaciones solo cuando agreguen valor.`;
}

function mergeGlobalFilters(args: Record<string, unknown>, filters: IntelligenceFilters) {
  const merged = { ...args };
  if (filters.retailerType && filters.retailerType !== "all") merged.retailerType = filters.retailerType;
  if (filters.supermarket) merged.supermarkets = [filters.supermarket];
  if (filters.category) merged.category = filters.category;
  if (filters.brand) merged.brand = filters.brand;
  if (filters.stock && filters.stock !== "all" && "stock" in merged) merged.stock = filters.stock;
  return merged;
}

function safeParseArguments(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return {} as Record<string, unknown>;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {} as Record<string, unknown>;
  }
}

function compactToolOutput(value: unknown) {
  const raw = JSON.stringify(value);
  if (raw.length <= 28_000) return raw;
  return JSON.stringify({
    truncated: true,
    note: "El resultado fue recortado para el modelo. Solicita una búsqueda más específica si necesitas mayor detalle.",
    preview: raw.slice(0, 27_000),
  });
}

function outputText(response: OpenAIResponse) {
  return (response.output ?? [])
    .filter((item) => item?.type === "message")
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .filter((item) => item?.type === "output_text" && typeof item?.text === "string")
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

async function createResponse(input: any[], access: EnterpriseAccessContext, filters: IntelligenceFilters) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 75_000);
  try {
    const response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${OPENAI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        instructions: instructions(access, filters),
        input,
        tools,
        tool_choice: "auto",
        store: false,
        include: ["reasoning.encrypted_content"],
        max_output_tokens: 2_200,
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({})) as OpenAIResponse;
    if (!response.ok) {
      const error = new Error(body?.error?.message || `OpenAI Responses API failed (${response.status})`);
      (error as Error & { status?: number }).status = response.status;
      throw error;
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

function likelyBrand(messages: IntelligenceChatMessage[], filters: IntelligenceFilters) {
  if (filters.brand) return filters.brand;
  const recent = [...messages].reverse().find((message) => message.brand)?.brand;
  return recent ?? null;
}

export function openAiIntelligenceConfigured() {
  return OPENAI_API_KEY.length > 20 && OPENAI_MODEL.length > 0 && clickHouseConfigured();
}

export function openAiIntelligenceModel() {
  return OPENAI_MODEL;
}

export async function runOpenAiIntelligenceAgent(
  messages: IntelligenceChatMessage[],
  filters: IntelligenceFilters,
  access: EnterpriseAccessContext,
): Promise<IntelligenceAgentResult> {
  if (!openAiIntelligenceConfigured()) throw new Error("OpenAI Intelligence is not configured");

  let input: any[] = cleanMessages(messages);
  const trace: string[] = [];

  for (let round = 0; round < 5; round += 1) {
    const response = await createResponse(input, access, filters);
    const calls = (response.output ?? []).filter((item) => item?.type === "function_call").slice(0, 4);

    if (!calls.length) {
      const answer = outputText(response);
      if (!answer) throw new Error(response.incomplete_details?.reason || "OpenAI returned no answer");
      return {
        answer,
        model: response.model || OPENAI_MODEL,
        ai: true,
        assistant: "MGP Intelligence",
        responseStyle: "conversational_clickhouse_agent",
        analysisMode: "clickhouse_tools",
        toolsUsed: [...new Set(trace)],
        dataSource: "clickhouse",
        brand: likelyBrand(messages, filters),
      };
    }

    const outputs = [] as Array<{ type: "function_call_output"; call_id: string; output: string }>;
    for (const call of calls) {
      const name = String(call?.name || "") as IntelligenceToolName;
      if (!TOOL_NAMES.has(name)) {
        outputs.push({ type: "function_call_output", call_id: String(call.call_id), output: JSON.stringify({ error: "tool_not_allowed" }) });
        continue;
      }
      const args = mergeGlobalFilters(safeParseArguments(call.arguments), filters);
      trace.push(name);
      try {
        const result = await executeIntelligenceTool(name, args, access);
        outputs.push({
          type: "function_call_output",
          call_id: String(call.call_id),
          output: compactToolOutput(result),
        });
      } catch {
        outputs.push({
          type: "function_call_output",
          call_id: String(call.call_id),
          output: JSON.stringify({ error: "data_tool_failed", source: "clickhouse" }),
        });
      }
    }

    input = [...input, ...(response.output ?? []), ...outputs];
  }

  throw new Error("OpenAI Intelligence exceeded the tool-call limit");
}
