import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";
import { clickHouseConfigured } from "@/lib/clickhouse";
import {
  dailyPricingTrendFromClickHouse,
  type DailyPricingPayload,
} from "@/lib/clickhouse-daily-pricing";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

function fallbackPayload(days: number, series: string[]): DailyPricingPayload {
  return {
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
    pollingSeconds: 300,
    historicalDaysFrozen: true,
    currentDayObservations: 0,
    previousDayObservations: 0,
    currentDayCoveragePct: null,
    method: "cached_trend_temporarily_unavailable",
    trimLowerPct: 5,
    trimUpperPct: 95,
    minimumPresencePct: 0,
    currency: "CLP",
    maxSeries: 8,
    cacheHit: false,
    temporarilyUnavailable: true,
    dataSource: "supabase",
  };
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
  const access = authorization.access!;

  const days = clampDays(request.nextUrl.searchParams.get("days"));
  const series = selectedSeries(request);

  if (clickHouseConfigured()) {
    try {
      return liveResponse(await dailyPricingTrendFromClickHouse(access, days, series));
    } catch {
      console.warn("ClickHouse daily pricing trend failed; falling back to Supabase.");
    }
  }

  const result = await enterpriseRpc<DailyPricingPayload>(request, "enterprise_daily_pricing_trend_cached", {
    p_organization_id: access.organizationId,
    p_days: days,
    p_series: series.length ? series : null,
  });

  if (result.response) {
    if (result.response.status >= 500) return liveResponse(fallbackPayload(days, series));
    return result.response;
  }
  return liveResponse(result.data
    ? { ...result.data, dataSource: "supabase" }
    : fallbackPayload(days, series));
}
