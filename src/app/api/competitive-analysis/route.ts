import { NextRequest, NextResponse } from "next/server";
import { supabaseRest } from "@/lib/supabase";
import {
  buildMetrics,
  deterministicExplanation,
  normalizeText,
  numeric,
  scoreCompetitor,
  type CompetitorMatch,
  type ProductRecord,
} from "@/lib/competitive-intelligence-v2";

export const dynamic = "force-dynamic";

const PRODUCT_SELECT = "id,supermarket,external_id,name,brand,category,url,image_url,regular_price,offer_price,unit,unit_price,in_stock,observed_at";
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://yfpixszkiakwzrqdcfbw.supabase.co";

function safeSearchTerm(value: string) {
  return value.replace(/[(),*]/g, " ").replace(/\s+/g, " ").trim();
}

function distinctiveToken(product: ProductRecord) {
  const brand = normalizeText(product.brand);
  const ignored = new Set(["producto", "original", "tradicional", "natural", "premium", ...brand.split(" ")]);
  return normalizeText(product.name)
    .split(" ")
    .filter((token) => token.length >= 4 && !ignored.has(token) && !/^\d/.test(token))
    .sort((a, b) => b.length - a.length)[0] ?? "";
}

function categoryTerm(category: string | null) {
  const tokens = normalizeText(category).split(" ").filter((token) => token.length >= 4);
  return tokens[tokens.length - 1] ?? "";
}

function deduplicate(products: ProductRecord[]) {
  const map = new Map<string, ProductRecord>();
  for (const product of products) map.set(product.id, product);
  return [...map.values()];
}

type AiNarrative = {
  enabled: boolean;
  model: string | null;
  explanation: string;
  actions: string[];
  risks: string[];
  error?: string;
};

async function createAiNarrative(request: NextRequest, target: ProductRecord, matches: CompetitorMatch[], fallback: string): Promise<AiNarrative> {
  const token = request.cookies.get("mgp_access_token")?.value;
  if (!token) return { enabled: false, model: null, explanation: fallback, actions: [], risks: [], error: "Sesión no disponible" };

  const compactMatches = matches.slice(0, 12).map((item) => ({
    id: item.id,
    name: item.name,
    supermarket: item.supermarket,
    brand: item.brand,
    category: item.category,
    price: numeric(item.offer_price) || numeric(item.regular_price),
    relationship: item.relationship,
    similarity: item.similarity,
    reasons: item.reasons,
    warnings: item.warnings,
  }));

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/competitive-ai`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ target, competitors: compactMatches }),
      cache: "no-store",
    });
    const result = await response.json() as {
      enabled?: boolean;
      model?: string;
      explanation?: string;
      actions?: unknown[];
      risks?: unknown[];
      error?: string;
    };

    if (!response.ok || !result.enabled) {
      return {
        enabled: false,
        model: result.model ?? null,
        explanation: fallback,
        actions: [],
        risks: [],
        error: result.error ?? `IA no disponible (${response.status})`,
      };
    }

    const explanation = typeof result.explanation === "string" && result.explanation.trim() ? result.explanation : fallback;
    const actions = Array.isArray(result.actions) ? result.actions.filter((item): item is string => typeof item === "string").slice(0, 3) : [];
    const risks = Array.isArray(result.risks) ? result.risks.filter((item): item is string => typeof item === "string").slice(0, 3) : [];
    return { enabled: true, model: result.model ?? null, explanation, actions, risks };
  } catch (error) {
    return {
      enabled: false,
      model: null,
      explanation: fallback,
      actions: [],
      risks: [],
      error: error instanceof Error ? error.message : "Error al conectar con IA",
    };
  }
}

async function searchProducts(query: string) {
  const cleaned = safeSearchTerm(query);
  return supabaseRest<ProductRecord[]>("dashboard_products", {
    query: {
      select: PRODUCT_SELECT,
      name: `ilike.*${cleaned}*`,
      order: "in_stock.desc,observed_at.desc",
      limit: "15",
    },
  });
}

async function candidatePool(target: ProductRecord) {
  const category = safeSearchTerm(categoryTerm(target.category));
  const token = safeSearchTerm(distinctiveToken(target));
  const base = { select: PRODUCT_SELECT, order: "in_stock.desc,observed_at.desc", limit: "1000" };
  const requests: Array<Promise<ProductRecord[]>> = [];
  if (category) requests.push(supabaseRest<ProductRecord[]>("dashboard_products", { query: { ...base, category: `ilike.*${category}*` } }));
  if (token) requests.push(supabaseRest<ProductRecord[]>("dashboard_products", { query: { ...base, name: `ilike.*${token}*` } }));
  if (!requests.length) requests.push(supabaseRest<ProductRecord[]>("dashboard_products", { query: base }));
  return deduplicate((await Promise.all(requests)).flat());
}

export async function GET(request: NextRequest) {
  const productId = request.nextUrl.searchParams.get("productId")?.trim() ?? "";
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";

  if (!productId && query.length < 2) {
    return NextResponse.json({ error: "Ingresa al menos dos caracteres o selecciona un producto." }, { status: 400 });
  }

  try {
    if (!productId) {
      const searchResults = await searchProducts(query);
      return NextResponse.json({ searchResults });
    }

    const targets = await supabaseRest<ProductRecord[]>("dashboard_products", {
      query: { select: PRODUCT_SELECT, id: `eq.${productId}`, limit: "1" },
    });
    const target = targets[0];
    if (!target) return NextResponse.json({ error: "El producto seleccionado ya no está disponible." }, { status: 404 });

    const pool = await candidatePool(target);
    const competitors = pool
      .map((candidate) => scoreCompetitor(target, candidate))
      .filter((candidate): candidate is CompetitorMatch => candidate !== null)
      .sort((left, right) => {
        const relationshipOrder = { equivalent: 0, direct_competitor: 1, substitute: 2 } as const;
        return relationshipOrder[left.relationship] - relationshipOrder[right.relationship]
          || right.similarity - left.similarity
          || numeric(left.offer_price) - numeric(right.offer_price);
      })
      .slice(0, 30);

    const metrics = buildMetrics(target, competitors);
    const fallback = deterministicExplanation(target, competitors, metrics);
    const ai = await createAiNarrative(request, target, competitors, fallback);

    return NextResponse.json({ target, competitors, metrics, ai, generatedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
