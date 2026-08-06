import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Numeric = number | string | null;
type Objective = "volume" | "balanced" | "margin";

type StoreListing = {
  supermarket: string;
  price: Numeric;
  in_stock?: boolean;
  url?: string;
};

type OptimizerProduct = {
  match_key: string;
  canonical_name: string;
  canonical_brand: string | null;
  category: string | null;
  smart_category: string | null;
  best_price: Numeric;
  average_price: Numeric;
  highest_price: Numeric;
  price_gap: Numeric;
  savings_pct: Numeric;
  match_method: string;
  match_confidence: Numeric;
  last_updated: string;
  image_url: string | null;
  store_listings: StoreListing[];
};

type ScenarioHistory = {
  id: string;
  match_key: string;
  product_name: string;
  objective: Objective;
  current_price: Numeric;
  recommended_price: Numeric;
  projected_units: Numeric;
  projected_revenue: Numeric;
  projected_gross_profit: Numeric;
  confidence: Numeric;
  created_at: string;
};

type RecommendationInput = {
  matchKey?: string;
  currentPrice?: number;
  unitCost?: number;
  baselineUnits?: number;
  stockUnits?: number | null;
  minMarginPct?: number;
  elasticity?: number;
  objective?: Objective;
};

type CalculatedScenario = {
  objective: Objective;
  recommendedPrice: number;
  projectedUnits: number;
  projectedRevenue: number;
  projectedGrossProfit: number;
  projectedMarginPct: number;
  priceChangePct: number;
  unitsChangePct: number;
  revenueChangePct: number;
  grossProfitChangePct: number;
  score: number;
};

function numberValue(value: Numeric | undefined, fallback = 0) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function retailRound(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value < 1000) return Math.max(10, Math.round(value / 10) * 10);
  const rounded = Math.round(value / 10) * 10;
  const hundred = Math.floor(rounded / 100) * 100;
  const candidates = [hundred + 90, hundred + 50, hundred + 100];
  return candidates.reduce((best, candidate) => Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best, candidates[0]);
}

function percentageDelta(next: number, current: number) {
  if (!current) return 0;
  return ((next / current) - 1) * 100;
}

function calculateScenario(
  objective: Objective,
  product: OptimizerProduct,
  currentPrice: number,
  unitCost: number,
  baselineUnits: number,
  stockUnits: number | null,
  minMarginPct: number,
  elasticity: number,
): CalculatedScenario {
  const marketMin = numberValue(product.best_price, currentPrice);
  const marketAverage = numberValue(product.average_price, currentPrice);
  const marketMax = numberValue(product.highest_price, marketAverage);
  const marginFloor = unitCost / Math.max(0.01, 1 - minMarginPct / 100);
  const lowerBound = Math.max(unitCost * 1.01, marginFloor, marketMin * 0.72);
  const upperBound = Math.max(lowerBound, currentPrice * 1.22, marketMax * 1.08);
  const baselineRevenue = currentPrice * baselineUnits;
  const baselineGrossProfit = Math.max(0, currentPrice - unitCost) * baselineUnits;
  let best: CalculatedScenario | null = null;

  for (let index = 0; index <= 80; index += 1) {
    const rawPrice = lowerBound + (upperBound - lowerBound) * (index / 80);
    const candidatePrice = retailRound(rawPrice);
    if (candidatePrice < marginFloor || candidatePrice <= unitCost) continue;

    const priceResponse = Math.pow(candidatePrice / currentPrice, elasticity);
    const marketPosition = marketAverage > 0 ? (marketAverage - candidatePrice) / marketAverage : 0;
    const marketLift = 1 + clamp(marketPosition * 0.28, -0.12, 0.12);
    let projectedUnits = baselineUnits * priceResponse * marketLift;
    if (stockUnits && stockUnits > 0) projectedUnits = Math.min(projectedUnits, stockUnits);
    projectedUnits = Math.max(0, projectedUnits);

    const projectedRevenue = candidatePrice * projectedUnits;
    const projectedGrossProfit = Math.max(0, candidatePrice - unitCost) * projectedUnits;
    const projectedMarginPct = candidatePrice > 0 ? ((candidatePrice - unitCost) / candidatePrice) * 100 : 0;
    const distanceToMarket = marketAverage > 0 ? Math.abs(candidatePrice - marketAverage) / marketAverage : 0;

    let score = projectedGrossProfit;
    if (objective === "volume") {
      score = projectedUnits * 1000 + projectedGrossProfit * 0.03 - Math.max(0, candidatePrice - marketMin) * baselineUnits * 0.08;
    } else if (objective === "balanced") {
      score = projectedGrossProfit + projectedRevenue * 0.12 - distanceToMarket * baselineRevenue * 0.22;
    } else {
      score = projectedGrossProfit + projectedMarginPct * baselineUnits * 2 - Math.max(0, candidatePrice - marketMax * 1.04) * baselineUnits;
    }

    const scenario: CalculatedScenario = {
      objective,
      recommendedPrice: candidatePrice,
      projectedUnits: Math.round(projectedUnits),
      projectedRevenue: Math.round(projectedRevenue),
      projectedGrossProfit: Math.round(projectedGrossProfit),
      projectedMarginPct: Number(projectedMarginPct.toFixed(1)),
      priceChangePct: Number(percentageDelta(candidatePrice, currentPrice).toFixed(1)),
      unitsChangePct: Number(percentageDelta(projectedUnits, baselineUnits).toFixed(1)),
      revenueChangePct: Number(percentageDelta(projectedRevenue, baselineRevenue).toFixed(1)),
      grossProfitChangePct: Number(percentageDelta(projectedGrossProfit, baselineGrossProfit).toFixed(1)),
      score,
    };

    if (!best || scenario.score > best.score) best = scenario;
  }

  if (best) return best;
  const fallbackPrice = retailRound(Math.max(marginFloor, marketAverage));
  const fallbackUnits = stockUnits && stockUnits > 0 ? Math.min(baselineUnits, stockUnits) : baselineUnits;
  return {
    objective,
    recommendedPrice: fallbackPrice,
    projectedUnits: Math.round(fallbackUnits),
    projectedRevenue: Math.round(fallbackPrice * fallbackUnits),
    projectedGrossProfit: Math.round(Math.max(0, fallbackPrice - unitCost) * fallbackUnits),
    projectedMarginPct: fallbackPrice > 0 ? Number((((fallbackPrice - unitCost) / fallbackPrice) * 100).toFixed(1)) : 0,
    priceChangePct: Number(percentageDelta(fallbackPrice, currentPrice).toFixed(1)),
    unitsChangePct: Number(percentageDelta(fallbackUnits, baselineUnits).toFixed(1)),
    revenueChangePct: Number(percentageDelta(fallbackPrice * fallbackUnits, baselineRevenue).toFixed(1)),
    grossProfitChangePct: Number(percentageDelta(Math.max(0, fallbackPrice - unitCost) * fallbackUnits, baselineGrossProfit).toFixed(1)),
    score: 0,
  };
}

function forecastWeeks(scenario: CalculatedScenario) {
  const factors = [0.94, 0.99, 1.03, 1.04];
  const total = factors.reduce((sum, item) => sum + item, 0);
  return factors.map((factor, index) => {
    const units = scenario.projectedUnits * (factor / total);
    return {
      week: index + 1,
      units: Math.round(units),
      revenue: Math.round(units * scenario.recommendedPrice),
    };
  });
}

function confidenceFor(product: OptimizerProduct, inputsComplete: boolean) {
  const matchConfidence = clamp(numberValue(product.match_confidence, 0.75), 0, 1);
  const modelConfidence = inputsComplete ? 0.74 : 0.62;
  return Number(clamp(matchConfidence * 0.58 + modelConfidence * 0.42, 0.55, 0.88).toFixed(3));
}

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "pricing");
  if (authorization.response) return authorization.response;

  const organizationId = authorization.access!.organizationId;
  const q = request.nextUrl.searchParams.get("q");
  const matchKey = request.nextUrl.searchParams.get("matchKey");
  const historyOnly = request.nextUrl.searchParams.get("history") === "true";

  if (historyOnly) {
    const history = await enterpriseRpc<ScenarioHistory[]>(request, "enterprise_price_optimizer_history", {
      p_organization_id: organizationId,
      p_limit: 20,
    });
    if (history.response) return history.response;
    return NextResponse.json({ history: history.data ?? [] });
  }

  const result = await enterpriseRpc<OptimizerProduct[]>(request, "enterprise_price_optimizer_catalog", {
    p_organization_id: organizationId,
    p_search: q || null,
    p_match_key: matchKey || null,
    p_limit: matchKey ? 1 : 35,
  });
  if (result.response) return result.response;
  return NextResponse.json({ products: result.data ?? [] });
}

export async function POST(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "pricing");
  if (authorization.response) return authorization.response;

  let input: RecommendationInput;
  try {
    input = await request.json() as RecommendationInput;
  } catch {
    return NextResponse.json({ error: "La solicitud no contiene datos válidos." }, { status: 400 });
  }

  const matchKey = String(input.matchKey ?? "").trim();
  const currentPrice = numberValue(input.currentPrice);
  const unitCost = numberValue(input.unitCost);
  const baselineUnits = numberValue(input.baselineUnits);
  const stockUnits = input.stockUnits == null ? null : numberValue(input.stockUnits);
  const minMarginPct = clamp(numberValue(input.minMarginPct, 20), 0, 85);
  const elasticity = clamp(numberValue(input.elasticity, -1.4), -4, -0.1);
  const objective: Objective = ["volume", "balanced", "margin"].includes(String(input.objective))
    ? input.objective as Objective
    : "balanced";

  if (!matchKey || currentPrice <= 0 || unitCost < 0 || unitCost >= currentPrice || baselineUnits <= 0) {
    return NextResponse.json({
      error: "Selecciona un producto e ingresa precio actual, costo y unidades válidas. El costo debe ser menor al precio.",
    }, { status: 400 });
  }

  const catalog = await enterpriseRpc<OptimizerProduct[]>(request, "enterprise_price_optimizer_catalog", {
    p_organization_id: authorization.access!.organizationId,
    p_search: null,
    p_match_key: matchKey,
    p_limit: 1,
  });
  if (catalog.response) return catalog.response;
  const product = catalog.data?.[0];
  if (!product) return NextResponse.json({ error: "El producto ya no está disponible para esta organización." }, { status: 404 });

  const scenarios = (["volume", "balanced", "margin"] as Objective[]).map((scenarioObjective) =>
    calculateScenario(scenarioObjective, product, currentPrice, unitCost, baselineUnits, stockUnits, minMarginPct, elasticity));
  const selected = scenarios.find((item) => item.objective === objective) ?? scenarios[1];
  const confidence = confidenceFor(product, true);
  const marketAverage = numberValue(product.average_price, currentPrice);
  const marginFloor = unitCost / Math.max(0.01, 1 - minMarginPct / 100);
  const rationale = [
    `La recomendación respeta un precio mínimo de ${retailRound(marginFloor)} para proteger el margen configurado.`,
    selected.recommendedPrice <= marketAverage
      ? "El precio recomendado queda en o bajo el promedio competitivo para favorecer conversión."
      : "El precio recomendado captura margen sobre el promedio competitivo sin superar el rango observado.",
    `La proyección usa una elasticidad estimada de ${elasticity.toFixed(2)}; con históricos de ventas podrá reemplazarse por elasticidad observada.`,
    stockUnits && stockUnits > 0
      ? "La proyección de unidades está limitada por el stock informado."
      : "La proyección no aplica límite de inventario porque no se informó stock disponible.",
  ];

  const recommendation = {
    product,
    selected,
    scenarios: scenarios.map(({ score, ...scenario }) => scenario),
    confidence,
    confidenceLabel: confidence >= 0.8 ? "Alta" : confidence >= 0.68 ? "Media-alta" : "Media",
    modelType: "elasticidad_estimada_competitiva",
    rationale,
    forecast: forecastWeeks(selected),
    baseline: {
      revenue: Math.round(currentPrice * baselineUnits),
      grossProfit: Math.round(Math.max(0, currentPrice - unitCost) * baselineUnits),
      marginPct: Number((((currentPrice - unitCost) / currentPrice) * 100).toFixed(1)),
    },
    market: {
      minimum: numberValue(product.best_price),
      average: marketAverage,
      maximum: numberValue(product.highest_price),
    },
  };

  const save = await enterpriseRpc<unknown>(request, "enterprise_save_price_optimizer_scenario", {
    p_organization_id: authorization.access!.organizationId,
    p_payload: {
      matchKey,
      productName: product.canonical_name,
      objective,
      currentPrice,
      unitCost,
      baselineUnits,
      stockUnits: stockUnits == null ? "" : stockUnits,
      minMarginPct,
      elasticity,
      recommendedPrice: selected.recommendedPrice,
      projectedUnits: selected.projectedUnits,
      projectedRevenue: selected.projectedRevenue,
      projectedGrossProfit: selected.projectedGrossProfit,
      confidence,
      inputs: input,
      recommendation,
    },
  });
  if (save.response) return save.response;

  return NextResponse.json({ recommendation, saved: save.data });
}
