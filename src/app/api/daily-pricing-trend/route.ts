import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type DailyPricingPayload = {
  series: Array<{
    id: string;
    label: string;
    dimension: "category" | "brand";
    kind: "group" | "smart" | "brand";
    points: Array<{ date: string; price: number | null; skus: number | null }>;
  }>;
  selectedSeries: string[];
  daysRequested: number;
  availableDays: number;
  firstDate: string | null;
  lastDate: string | null;
  refreshedAt: string | null;
  latestObservationAt: string | null;
  partialDay: boolean;
  live: boolean;
  pollingSeconds: number;
  historicalDaysFrozen: boolean;
  currentDayObservations: number;
  previousDayObservations: number;
  currentDayCoveragePct: number | null;
  method: string;
  trimLowerPct: number;
  trimUpperPct: number;
  minimumPresencePct: number;
  currency: string;
  maxSeries: number;
};

function clampDays(value: string | null) {
  const parsed = Number(value ?? 30);
  if (![30, 60, 90].includes(parsed)) return 30;
  return parsed;
}

function selectedSeries(request: NextRequest) {
  return [...new Set(request.nextUrl.searchParams.getAll("series")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && value.length <= 180 && /^(group|smart|brand):/.test(value)))]
    .slice(0, 8);
}

function liveResponse(payload: DailyPricingPayload) {
  return NextResponse.json(payload, {
    headers: {
      "cache-control": "private, no-store, max-age=0, must-revalidate",
      pragma: "no-cache",
      expires: "0",
    },
  });
}

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "overview");
  if (authorization.response) return authorization.response;

  const days = clampDays(request.nextUrl.searchParams.get("days"));
  const series = selectedSeries(request);
  const result = await enterpriseRpc<DailyPricingPayload>(request, "enterprise_daily_pricing_trend_v2", {
    p_organization_id: authorization.access?.organizationId,
    p_days: days,
    p_series: series.length ? series : null,
  });

  if (result.response) return result.response;
  return liveResponse(result.data ?? {
    series: [],
    selectedSeries: series,
    daysRequested: days,
    availableDays: 0,
    firstDate: null,
    lastDate: null,
    refreshedAt: null,
    latestObservationAt: null,
    partialDay: false,
    live: true,
    pollingSeconds: 20,
    historicalDaysFrozen: true,
    currentDayObservations: 0,
    previousDayObservations: 0,
    currentDayCoveragePct: null,
    method: "trimmed_mean_live_dynamic_series",
    trimLowerPct: 5,
    trimUpperPct: 95,
    minimumPresencePct: 0,
    currency: "CLP",
    maxSeries: 8,
  });
}
