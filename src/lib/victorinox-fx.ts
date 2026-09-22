export type VictorinoxFxPoint = {
  date: string;
  chfClp: number;
  usdClp: number;
  chfUsd: number;
};

export type VictorinoxFxSource = {
  provider: "frankfurter-v2" | "yahoo-finance";
  label: string;
  frequency: "daily" | "business-day";
};

export type VictorinoxFxScenarioInput = {
  baselineGrossMarginPct: number;
  chfLinkedCostSharePct: number;
  localPriceAdjustmentPct: number;
};

type FrankfurterRate = { date?: string; base?: string; quote?: string; rate?: number };

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
  };
};

type CachedSeries = {
  points: VictorinoxFxPoint[];
  source: VictorinoxFxSource;
  fetchedAt: string;
  expiresAt: number;
  staleUntil: number;
};

export class VictorinoxFxUnavailableError extends Error {
  constructor(message = "No fue posible obtener las referencias cambiarias.") {
    super(message);
    this.name = "VictorinoxFxUnavailableError";
  }
}

const CACHE_TTL_MS = 4 * 60 * 60 * 1_000;
const STALE_TTL_MS = 72 * 60 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 8_000;
const cache = new Map<string, CachedSeries>();

function round(value: number, decimals = 4) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "MGP-Super-Precios/1.0" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`FX provider responded ${response.status}`);
  return response.json() as Promise<T>;
}

async function fetchFrankfurterV2(start: string, end: string) {
  const query = new URLSearchParams({ base: "CHF", quotes: "CLP,USD", from: start, to: end });
  const payload = await fetchJson<FrankfurterRate[]>(`https://api.frankfurter.dev/v2/rates?${query.toString()}`);
  const byDate = new Map<string, { clp?: number; usd?: number }>();
  payload.forEach((entry) => {
    if (!entry.date || !entry.quote || !isFinitePositive(entry.rate)) return;
    const rates = byDate.get(entry.date) ?? {};
    if (entry.quote === "CLP") rates.clp = entry.rate;
    if (entry.quote === "USD") rates.usd = entry.rate;
    byDate.set(entry.date, rates);
  });
  const points = [...byDate.entries()]
    .flatMap(([date, rates]) => {
      if (!isFinitePositive(rates.clp) || !isFinitePositive(rates.usd)) return [];
      return [{
        date,
        chfClp: round(rates.clp),
        usdClp: round(rates.clp / rates.usd),
        chfUsd: round(rates.usd, 6),
      }];
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  if (points.length < 2) throw new Error("Frankfurter v2 returned an incomplete FX series");
  return {
    points,
    source: {
      provider: "frankfurter-v2",
      label: "Frankfurter v2 (referencias diarias de bancos centrales)",
      frequency: "daily",
    } satisfies VictorinoxFxSource,
  };
}

function yahooSeries(payload: YahooChartResponse) {
  const result = payload.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const values = new Map<string, number>();
  timestamps.forEach((timestamp, index) => {
    const close = closes[index];
    if (isFinitePositive(close)) values.set(dateKey(new Date(timestamp * 1_000)), close);
  });
  return values;
}

async function fetchYahoo(start: string, end: string) {
  const period1 = Math.floor(new Date(`${start}T00:00:00Z`).getTime() / 1_000);
  const period2 = Math.floor(new Date(`${end}T00:00:00Z`).getTime() / 1_000) + 86_400;
  const params = new URLSearchParams({
    period1: String(period1), period2: String(period2), interval: "1d", events: "history",
  });
  const [chfPayload, usdPayload] = await Promise.all([
    fetchJson<YahooChartResponse>(`https://query1.finance.yahoo.com/v8/finance/chart/CHFCLP=X?${params.toString()}`),
    fetchJson<YahooChartResponse>(`https://query1.finance.yahoo.com/v8/finance/chart/CLP=X?${params.toString()}`),
  ]);
  const chf = yahooSeries(chfPayload);
  const usd = yahooSeries(usdPayload);
  const points = [...chf.entries()]
    .flatMap(([date, chfClp]) => {
      const usdClp = usd.get(date);
      if (!isFinitePositive(usdClp)) return [];
      return [{ date, chfClp: round(chfClp), usdClp: round(usdClp), chfUsd: round(chfClp / usdClp, 6) }];
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  if (points.length < 2) throw new Error("Yahoo Finance returned an incomplete FX series");
  return {
    points,
    source: {
      provider: "yahoo-finance",
      label: "Yahoo Finance (referencia de mercado diaria)",
      frequency: "business-day",
    } satisfies VictorinoxFxSource,
  };
}

export async function getVictorinoxFxSeries(days = 400) {
  const safeDays = Math.max(35, Math.min(Math.round(days), 1_900));
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - safeDays);
  const start = dateKey(startDate);
  const end = dateKey(endDate);
  // Key by requested window so a warm instance can still serve yesterday's verified
  // series if both upstream providers are temporarily unavailable after midnight.
  const cacheKey = String(safeDays);
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) return { ...cached, cacheStatus: "hit" as const };

  const providers = [fetchFrankfurterV2, fetchYahoo];
  for (const provider of providers) {
    try {
      const result = await provider(start, end);
      const entry: CachedSeries = {
        ...result,
        fetchedAt: new Date().toISOString(),
        expiresAt: now + CACHE_TTL_MS,
        staleUntil: now + STALE_TTL_MS,
      };
      cache.set(cacheKey, entry);
      return { ...entry, cacheStatus: "miss" as const };
    } catch (error) {
      console.warn("victorinox-fx-provider-failed", {
        provider: provider.name,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  if (cached && cached.staleUntil > now) return { ...cached, cacheStatus: "stale" as const };
  throw new VictorinoxFxUnavailableError();
}

function changePct(current: number, previous: number) {
  return round(((current / previous) - 1) * 100, 2);
}

function pointAtOrBefore(points: VictorinoxFxPoint[], target: Date) {
  const key = dateKey(target);
  for (let index = points.length - 1; index >= 0; index -= 1) {
    if (points[index].date <= key) return points[index];
  }
  return points[0];
}

export function summarizeVictorinoxFx(points: VictorinoxFxPoint[]) {
  if (points.length < 2) throw new VictorinoxFxUnavailableError("La serie cambiaria está incompleta.");
  const current = points[points.length - 1];
  const periods = [30, 90, 365].map((days) => {
    const target = new Date(`${current.date}T00:00:00Z`);
    target.setUTCDate(target.getUTCDate() - days);
    const baseline = pointAtOrBefore(points, target);
    const chfClpChangePct = changePct(current.chfClp, baseline.chfClp);
    const usdClpChangePct = changePct(current.usdClp, baseline.usdClp);
    return {
      days,
      baseline,
      chfClpChangePct,
      usdClpChangePct,
      relativeChfPressurePct: round((((current.chfClp / baseline.chfClp) / (current.usdClp / baseline.usdClp)) - 1) * 100, 2),
    };
  });
  return { current, periods };
}

export function simulateVictorinoxFxMargin(
  current: VictorinoxFxPoint,
  baseline: VictorinoxFxPoint,
  input: VictorinoxFxScenarioInput,
) {
  const baselineMargin = input.baselineGrossMarginPct / 100;
  const linkedShare = input.chfLinkedCostSharePct / 100;
  const baselineRevenue = 100;
  const baselineCogs = baselineRevenue * (1 - baselineMargin);
  const fxFactor = current.chfClp / baseline.chfClp;
  const currentCogs = baselineCogs * ((1 - linkedShare) + (linkedShare * fxFactor));
  const currentRevenue = baselineRevenue * (1 + (input.localPriceAdjustmentPct / 100));
  const projectedMarginPct = ((currentRevenue - currentCogs) / currentRevenue) * 100;
  const requiredRevenue = currentCogs / (1 - baselineMargin);
  return {
    assumptions: input,
    chfCostChangePct: changePct(current.chfClp, baseline.chfClp),
    projectedGrossMarginPct: round(projectedMarginPct, 2),
    grossMarginChangePp: round(projectedMarginPct - input.baselineGrossMarginPct, 2),
    priceAdjustmentToPreserveMarginPct: round((requiredRevenue - baselineRevenue), 2),
    note: "Escenario ilustrativo: no reemplaza los costos, coberturas ni márgenes contables de Victorinox Chile.",
  };
}
