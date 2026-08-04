import { NextRequest, NextResponse } from "next/server";
import { supabaseRest } from "@/lib/supabase";

type Product = {
  id: string;
  supermarket: string;
  external_id: string;
  name: string;
  brand: string | null;
  category: string | null;
  url: string;
  image_url: string | null;
  regular_price: number | string | null;
  offer_price: number | string;
  unit: string | null;
  unit_price: number | string | null;
  in_stock: boolean;
  observed_at: string;
};

type Candidate = Product & {
  similarity: number;
  relationship: "equivalent" | "direct_competitor" | "substitute";
  reasons: string[];
  price_gap: number;
  price_gap_pct: number;
};

const STOPWORDS = new Set([
  "de", "del", "la", "el", "los", "las", "con", "sin", "para", "y", "en", "un", "una",
  "pack", "unidad", "unidades", "producto", "marca", "nuevo", "nueva",
]);

function numberValue(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value: string | null | undefined) {
  return new Set(normalize(value).split(/\s+/).filter((token) => token.length > 1 && !STOPWORDS.has(token)));
}

function jaccard(left: Set<string>, right: Set<string>) {
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

function extractMeasure(name: string) {
  const normalized = normalize(name).replace(/,/g, ".");
  const matches = [...normalized.matchAll(/(\d+(?:\.\d+)?)\s*(kg|g|gr|mg|l|lt|ml|cc|un|u)\b/g)];
  if (!matches.length) return null;
  const match = matches.at(-1)!;
  let amount = Number(match[1]);
  let unit = match[2];
  if (unit === "kg") { amount *= 1000; unit = "g"; }
  if (unit === "l" || unit === "lt") { amount *= 1000; unit = "ml"; }
  if (unit === "gr") unit = "g";
  if (unit === "cc") unit = "ml";
  if (unit === "u") unit = "un";
  return { amount, unit };
}

function measureSimilarity(a: ReturnType<typeof extractMeasure>, b: ReturnType<typeof extractMeasure>) {
  if (!a || !b) return 0.55;
  if (a.unit !== b.unit) return 0;
  return Math.min(a.amount, b.amount) / Math.max(a.amount, b.amount);
}

function broadCategory(category: string | null) {
  return normalize(category).split(" ").slice(0, 4).join(" ");
}

function classify(referencePrice: number, marketAverage: number) {
  const diffPct = marketAverage > 0 ? ((referencePrice - marketAverage) / marketAverage) * 100 : 0;
  if (diffPct <= -5) return { code: "low", label: "Bajo precio", diffPct };
  if (diffPct < 5) return { code: "equal", label: "Precio equivalente", diffPct };
  if (diffPct < 15) return { code: "high", label: "Precio alto", diffPct };
  return { code: "overpriced", label: "Sobreprecio", diffPct };
}

function scoreCandidate(target: Product, candidate: Product): Candidate | null {
  if (target.id === candidate.id || target.supermarket === candidate.supermarket) return null;
  const targetName = tokens(target.name);
  const candidateName = tokens(candidate.name);
  const lexical = jaccard(targetName, candidateName);
  const targetCategory = broadCategory(target.category);
  const candidateCategory = broadCategory(candidate.category);
  const sameCategory = Boolean(targetCategory && candidateCategory && (targetCategory.includes(candidateCategory) || candidateCategory.includes(targetCategory)));
  const measure = measureSimilarity(extractMeasure(target.name), extractMeasure(candidate.name));
  const sameBrand = normalize(target.brand) !== "" && normalize(target.brand) === normalize(candidate.brand);
  const score = lexical * 0.52 + measure * 0.23 + (sameCategory ? 0.18 : 0) + (sameBrand ? 0.07 : 0);
  if (score < 0.36 || measure < 0.55) return null;

  const reasons: string[] = [];
  if (sameCategory) reasons.push("misma categoría");
  if (lexical >= 0.55) reasons.push("descripción altamente similar");
  else if (lexical >= 0.35) reasons.push("atributos de producto relacionados");
  if (measure >= 0.9) reasons.push("formato equivalente");
  else if (measure >= 0.7) reasons.push("formato comparable");
  if (sameBrand) reasons.push("misma marca");

  const targetPrice = numberValue(target.offer_price);
  const candidatePrice = numberValue(candidate.offer_price);
  const priceGap = targetPrice - candidatePrice;
  const priceGapPct = candidatePrice > 0 ? (priceGap / candidatePrice) * 100 : 0;
  const relationship: Candidate["relationship"] = sameBrand && measure >= 0.9 && lexical >= 0.6
    ? "equivalent"
    : measure >= 0.8 && lexical >= 0.42
      ? "direct_competitor"
      : "substitute";

  return { ...candidate, similarity: Math.round(score * 1000) / 10, relationship, reasons, price_gap: priceGap, price_gap_pct: priceGapPct };
}

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const productId = request.nextUrl.searchParams.get("productId")?.trim();
  const query = request.nextUrl.searchParams.get("q")?.trim();

  if (!productId && (!query || query.length < 2)) {
    return NextResponse.json({ error: "Ingresa al menos dos caracteres o selecciona un producto" }, { status: 400 });
  }

  try {
    const targetQuery: Record<string, string> = {
      select: "id,supermarket,external_id,name,brand,category,url,image_url,regular_price,offer_price,unit,unit_price,in_stock,observed_at",
      order: "in_stock.desc,observed_at.desc",
      limit: productId ? "1" : "12",
    };
    if (productId) targetQuery.id = `eq.${productId}`;
    else targetQuery.name = `ilike.*${query!.replace(/[,*]/g, " ")}*`;

    const targets = await supabaseRest<Product[]>("dashboard_products", { query: targetQuery });

    if (!targets.length) return NextResponse.json({ error: "No encontramos productos para analizar" }, { status: 404 });
    if (!productId) return NextResponse.json({ searchResults: targets });

    const target = targets[0];
    const categoryTerm = broadCategory(target.category).split(" ").filter(Boolean).at(-1);
    const candidateQuery: Record<string, string> = {
      select: "id,supermarket,external_id,name,brand,category,url,image_url,regular_price,offer_price,unit,unit_price,in_stock,observed_at",
      order: "observed_at.desc",
      limit: "1200",
    };
    if (categoryTerm) candidateQuery.category = `ilike.*${categoryTerm}*`;

    const pool = await supabaseRest<Product[]>("dashboard_products", { query: candidateQuery });
    const competitors = pool
      .map((candidate) => scoreCandidate(target, candidate))
      .filter((candidate): candidate is Candidate => Boolean(candidate))
      .sort((a, b) => b.similarity - a.similarity || numberValue(a.offer_price) - numberValue(b.offer_price))
      .slice(0, 20);

    const competitiveSet: Product[] = [target, ...competitors.filter((item) => item.relationship !== "substitute").slice(0, 9)];
    const prices = competitiveSet.map((item) => numberValue(item.offer_price)).filter((price) => price > 0);
    const marketAverage = prices.length ? prices.reduce((sum, price) => sum + price, 0) / prices.length : 0;
    const marketMin = prices.length ? Math.min(...prices) : 0;
    const marketMax = prices.length ? Math.max(...prices) : 0;
    const referencePrice = numberValue(target.offer_price);
    const position = classify(referencePrice, marketAverage);
    const sorted = [...prices].sort((a, b) => a - b);
    const rank = sorted.findIndex((price) => price === referencePrice) + 1;
    const recommendedMin = Math.round(marketAverage * 0.95);
    const recommendedMax = Math.round(marketAverage * 1.05);

    const explanation = competitors.length
      ? `${target.name} se comparó con ${competitors.length} productos de otras cadenas. El motor ponderó categoría, similitud de atributos, marca y equivalencia de formato. Su precio está ${Math.abs(position.diffPct).toFixed(1)}% ${position.diffPct >= 0 ? "sobre" : "bajo"} el promedio del set competitivo.`
      : "Todavía no existe un set competitivo con confianza suficiente. Esto puede ocurrir cuando faltan productos comparables o el formato no coincide.";

    return NextResponse.json({
      target,
      competitors,
      metrics: {
        marketAverage,
        marketMin,
        marketMax,
        referencePrice,
        position,
        rank,
        totalRanked: prices.length,
        recommendedMin,
        recommendedMax,
        gapVsCheapest: referencePrice - marketMin,
        gapVsCheapestPct: marketMin > 0 ? ((referencePrice - marketMin) / marketMin) * 100 : 0,
      },
      explanation,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
