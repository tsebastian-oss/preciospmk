export type ProductRecord = {
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

export type Relationship = "equivalent" | "direct_competitor" | "substitute";

export type CompetitorMatch = ProductRecord & {
  relationship: Relationship;
  similarity: number;
  confidence: "high" | "medium" | "low";
  reasons: string[];
  warnings: string[];
  price_gap: number;
  price_gap_pct: number;
  normalized_unit_price: number | null;
};

export type PricingPosition = {
  code: "low" | "equal" | "high" | "overpriced";
  label: string;
  diffPct: number;
};

export type CompetitiveMetrics = {
  referencePrice: number;
  marketAverage: number;
  marketMedian: number;
  marketMin: number;
  marketMax: number;
  rank: number;
  totalRanked: number;
  recommendedMin: number;
  recommendedMax: number;
  gapVsCheapest: number;
  gapVsCheapestPct: number;
  position: PricingPosition;
  equivalentCount: number;
  directCount: number;
  substituteCount: number;
};

const STOPWORDS = new Set([
  "a", "al", "con", "de", "del", "el", "en", "la", "las", "lo", "los", "para", "por", "sin", "un", "una", "y",
  "pack", "producto", "nuevo", "nueva", "unidad", "unidades", "formato", "marca",
]);

const GENERIC_TOKENS = new Set([
  "original", "tradicional", "clasico", "clasica", "regular", "natural", "premium", "especial", "seleccion",
]);

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function numeric(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/,/g, ".")
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value: string | null | undefined, ignoreGeneric = false) {
  const result = new Set<string>();
  for (const token of normalizeText(value).split(" ")) {
    if (token.length < 2 || STOPWORDS.has(token) || /^\d+(?:\.\d+)?$/.test(token)) continue;
    if (ignoreGeneric && GENERIC_TOKENS.has(token)) continue;
    result.add(token);
  }
  return result;
}

function weightedJaccard(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  let union = 0;
  const tokens = new Set<string>();
  left.forEach((token) => tokens.add(token));
  right.forEach((token) => tokens.add(token));
  tokens.forEach((token) => {
    const weight = GENERIC_TOKENS.has(token) ? 0.35 : token.length >= 7 ? 1.25 : 1;
    union += weight;
    if (left.has(token) && right.has(token)) intersection += weight;
  });
  return union > 0 ? intersection / union : 0;
}

function categorySimilarity(left: string | null, right: string | null) {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  if (!normalizedLeft || !normalizedRight) return 0.45;
  if (normalizedLeft === normalizedRight) return 1;
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) return 0.9;
  return weightedJaccard(tokenSet(normalizedLeft), tokenSet(normalizedRight));
}

type PackageMeasure = {
  family: "mass" | "volume" | "count";
  total: number;
  unit: "g" | "ml" | "un";
  packCount: number;
  itemAmount: number;
  source: string;
};

function normalizeUnit(raw: string): { family: PackageMeasure["family"]; unit: PackageMeasure["unit"]; multiplier: number } | null {
  const unit = raw.toLowerCase();
  if (unit === "kg" || unit === "kilo" || unit === "kilos") return { family: "mass", unit: "g", multiplier: 1000 };
  if (unit === "g" || unit === "gr" || unit === "gramo" || unit === "gramos") return { family: "mass", unit: "g", multiplier: 1 };
  if (unit === "mg") return { family: "mass", unit: "g", multiplier: 0.001 };
  if (unit === "l" || unit === "lt" || unit === "litro" || unit === "litros") return { family: "volume", unit: "ml", multiplier: 1000 };
  if (unit === "ml" || unit === "cc") return { family: "volume", unit: "ml", multiplier: 1 };
  if (unit === "un" || unit === "u" || unit === "unidad" || unit === "unidades") return { family: "count", unit: "un", multiplier: 1 };
  return null;
}

export function extractPackage(name: string, explicitUnit?: string | null): PackageMeasure | null {
  const text = normalizeText(`${name} ${explicitUnit ?? ""}`);
  const packPattern = /(?:pack\s*)?(\d{1,3})\s*[xX]\s*(\d+(?:\.\d+)?)\s*(kg|kilo|kilos|g|gr|gramo|gramos|mg|l|lt|litro|litros|ml|cc|un|u|unidad|unidades)\b/gi;
  const packMatch = packPattern.exec(text);
  if (packMatch) {
    const count = Number(packMatch[1]);
    const amount = Number(packMatch[2]);
    const unit = normalizeUnit(packMatch[3]);
    if (unit && count > 0 && amount > 0) {
      const itemAmount = amount * unit.multiplier;
      return { family: unit.family, unit: unit.unit, packCount: count, itemAmount, total: count * itemAmount, source: packMatch[0] };
    }
  }

  const reversePackPattern = /(\d+(?:\.\d+)?)\s*(kg|kilo|kilos|g|gr|gramo|gramos|mg|l|lt|litro|litros|ml|cc)\s*[xX]\s*(\d{1,3})\b/gi;
  const reverseMatch = reversePackPattern.exec(text);
  if (reverseMatch) {
    const amount = Number(reverseMatch[1]);
    const count = Number(reverseMatch[3]);
    const unit = normalizeUnit(reverseMatch[2]);
    if (unit && count > 0 && amount > 0) {
      const itemAmount = amount * unit.multiplier;
      return { family: unit.family, unit: unit.unit, packCount: count, itemAmount, total: count * itemAmount, source: reverseMatch[0] };
    }
  }

  const singlePattern = /(\d+(?:\.\d+)?)\s*(kg|kilo|kilos|g|gr|gramo|gramos|mg|l|lt|litro|litros|ml|cc|un|u|unidad|unidades)\b/gi;
  let match: RegExpExecArray | null = null;
  let lastMatch: RegExpExecArray | null = null;
  while ((match = singlePattern.exec(text)) !== null) lastMatch = match;
  if (!lastMatch) return null;
  const amount = Number(lastMatch[1]);
  const unit = normalizeUnit(lastMatch[2]);
  if (!unit || amount <= 0) return null;
  const normalizedAmount = amount * unit.multiplier;
  return { family: unit.family, unit: unit.unit, packCount: 1, itemAmount: normalizedAmount, total: normalizedAmount, source: lastMatch[0] };
}

function packageSimilarity(left: PackageMeasure | null, right: PackageMeasure | null) {
  if (!left && !right) return 0.58;
  if (!left || !right) return 0.46;
  if (left.family !== right.family) return 0;
  const totalRatio = Math.min(left.total, right.total) / Math.max(left.total, right.total);
  const itemRatio = Math.min(left.itemAmount, right.itemAmount) / Math.max(left.itemAmount, right.itemAmount);
  const packRatio = Math.min(left.packCount, right.packCount) / Math.max(left.packCount, right.packCount);
  return clamp(totalRatio * 0.68 + itemRatio * 0.22 + packRatio * 0.1);
}

function normalizedUnitPrice(product: ProductRecord, measure: PackageMeasure | null) {
  const explicit = numeric(product.unit_price);
  if (explicit > 0) return explicit;
  const price = numeric(product.offer_price) || numeric(product.regular_price);
  if (!measure || price <= 0 || measure.total <= 0) return null;
  if (measure.family === "mass" || measure.family === "volume") return (price / measure.total) * 1000;
  return price / measure.total;
}

function brandSimilarity(left: string | null, right: string | null) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return 0.5;
  if (a === b) return 1;
  return weightedJaccard(tokenSet(a), tokenSet(b));
}

function confidence(score: number): CompetitorMatch["confidence"] {
  if (score >= 82) return "high";
  if (score >= 66) return "medium";
  return "low";
}

function relationshipFromScores(params: {
  score: number;
  sameBrand: boolean;
  lexical: number;
  category: number;
  packageScore: number;
}): Relationship | null {
  const { score, sameBrand, lexical, category, packageScore } = params;
  if (sameBrand && lexical >= 0.58 && packageScore >= 0.82 && score >= 0.7) return "equivalent";
  if (category >= 0.58 && packageScore >= 0.68 && lexical >= 0.3 && score >= 0.56) return "direct_competitor";
  if (category >= 0.55 && lexical >= 0.2 && score >= 0.47) return "substitute";
  return null;
}

export function scoreCompetitor(target: ProductRecord, candidate: ProductRecord): CompetitorMatch | null {
  if (target.id === candidate.id || target.supermarket === candidate.supermarket) return null;
  const targetMeasure = extractPackage(target.name, target.unit);
  const candidateMeasure = extractPackage(candidate.name, candidate.unit);
  const packageScore = packageSimilarity(targetMeasure, candidateMeasure);
  if (targetMeasure && candidateMeasure && targetMeasure.family !== candidateMeasure.family) return null;
  if (targetMeasure && candidateMeasure && packageScore < 0.42) return null;

  const lexical = weightedJaccard(tokenSet(target.name, true), tokenSet(candidate.name, true));
  const category = categorySimilarity(target.category, candidate.category);
  const brand = brandSimilarity(target.brand, candidate.brand);
  const sameBrand = normalizeText(target.brand) !== "" && normalizeText(target.brand) === normalizeText(candidate.brand);
  const targetUnitPrice = normalizedUnitPrice(target, targetMeasure);
  const candidateUnitPrice = normalizedUnitPrice(candidate, candidateMeasure);
  let unitPriceScore = 0.5;
  if (targetUnitPrice && candidateUnitPrice) unitPriceScore = Math.min(targetUnitPrice, candidateUnitPrice) / Math.max(targetUnitPrice, candidateUnitPrice);

  const rawScore = lexical * 0.38 + category * 0.25 + packageScore * 0.27 + brand * 0.06 + unitPriceScore * 0.04;
  const relationship = relationshipFromScores({ score: rawScore, sameBrand, lexical, category, packageScore });
  if (!relationship) return null;

  const reasons: string[] = [];
  const warnings: string[] = [];
  if (category >= 0.85) reasons.push("misma categoría");
  else if (category >= 0.58) reasons.push("categoría relacionada");
  if (lexical >= 0.65) reasons.push("atributos altamente similares");
  else if (lexical >= 0.38) reasons.push("atributos comparables");
  if (packageScore >= 0.9) reasons.push("formato equivalente");
  else if (packageScore >= 0.68) reasons.push("formato comparable");
  if (sameBrand) reasons.push("misma marca");
  if (!targetMeasure || !candidateMeasure) warnings.push("formato incompleto");
  if (!target.brand || !candidate.brand) warnings.push("marca no informada");

  const targetPrice = numeric(target.offer_price) || numeric(target.regular_price);
  const candidatePrice = numeric(candidate.offer_price) || numeric(candidate.regular_price);
  const gap = targetPrice - candidatePrice;
  const gapPct = candidatePrice > 0 ? (gap / candidatePrice) * 100 : 0;
  const similarity = Math.round(rawScore * 1000) / 10;

  return {
    ...candidate,
    relationship,
    similarity,
    confidence: confidence(similarity),
    reasons,
    warnings,
    price_gap: gap,
    price_gap_pct: gapPct,
    normalized_unit_price: candidateUnitPrice,
  };
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function classifyPosition(referencePrice: number, benchmark: number): PricingPosition {
  const diffPct = benchmark > 0 ? ((referencePrice - benchmark) / benchmark) * 100 : 0;
  if (diffPct <= -7) return { code: "low", label: "Bajo precio", diffPct };
  if (diffPct < 7) return { code: "equal", label: "Precio equivalente", diffPct };
  if (diffPct < 18) return { code: "high", label: "Precio alto", diffPct };
  return { code: "overpriced", label: "Sobreprecio", diffPct };
}

export function buildMetrics(target: ProductRecord, competitors: CompetitorMatch[]): CompetitiveMetrics {
  const referencePrice = numeric(target.offer_price) || numeric(target.regular_price);
  const strict = competitors.filter((item) => item.relationship !== "substitute" && item.confidence !== "low");
  const comparison = strict.length ? strict : competitors.filter((item) => item.relationship !== "substitute");
  const prices = [referencePrice, ...comparison.map((item) => numeric(item.offer_price) || numeric(item.regular_price))].filter((price) => price > 0);
  const marketAverage = prices.length ? prices.reduce((sum, price) => sum + price, 0) / prices.length : 0;
  const marketMedian = median(prices);
  const marketMin = prices.length ? Math.min(...prices) : 0;
  const marketMax = prices.length ? Math.max(...prices) : 0;
  const sorted = [...prices].sort((a, b) => a - b);
  const rank = referencePrice > 0 ? sorted.findIndex((price) => price === referencePrice) + 1 : 0;
  const benchmark = marketMedian || marketAverage;
  const recommendedMin = Math.round(benchmark * 0.95);
  const recommendedMax = Math.round(benchmark * 1.05);
  return {
    referencePrice,
    marketAverage,
    marketMedian,
    marketMin,
    marketMax,
    rank,
    totalRanked: prices.length,
    recommendedMin,
    recommendedMax,
    gapVsCheapest: referencePrice - marketMin,
    gapVsCheapestPct: marketMin > 0 ? ((referencePrice - marketMin) / marketMin) * 100 : 0,
    position: classifyPosition(referencePrice, benchmark),
    equivalentCount: competitors.filter((item) => item.relationship === "equivalent").length,
    directCount: competitors.filter((item) => item.relationship === "direct_competitor").length,
    substituteCount: competitors.filter((item) => item.relationship === "substitute").length,
  };
}

export function deterministicExplanation(target: ProductRecord, competitors: CompetitorMatch[], metrics: CompetitiveMetrics) {
  const strictCount = metrics.equivalentCount + metrics.directCount;
  if (!competitors.length) return `No se encontró un set competitivo con confianza suficiente para ${target.name}. El sistema evitará recomendar precio hasta contar con formatos y categorías comparables.`;
  const direction = metrics.position.diffPct >= 0 ? "sobre" : "bajo";
  const confidenceHigh = competitors.filter((item) => item.confidence === "high").length;
  return `${target.name} fue comparado con ${strictCount} productos equivalentes o competidores directos y ${metrics.substituteCount} sustitutos cercanos. El precio está ${Math.abs(metrics.position.diffPct).toFixed(1)}% ${direction} la mediana competitiva. ${confidenceHigh} matches tienen confianza alta. El rango sugerido es ${Math.round(metrics.recommendedMin).toLocaleString("es-CL")}–${Math.round(metrics.recommendedMax).toLocaleString("es-CL")} CLP.`;
}
