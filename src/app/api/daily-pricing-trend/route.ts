import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type DailyPricingPayload = {
  data: Array<{
    date: string;
    nonAlcoholic: number | null;
    grocery: number | null;
    alcoholic: number | null;
    nonAlcoholicSkus: number | null;
    grocerySkus: number | null;
    alcoholicSkus: number | null;
  }>;
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
};

function clampDays(value: string | null) {
  const parsed = Number(value ?? 30);
  if (![30, 60, 90].includes(parsed)) return 30;
  return parsed;
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
  const result = await enterpriseRpc<DailyPricingPayload>(request, "enterprise_daily_pricing_trend", {
    p_organization_id: authorization.access?.organizationId,
    p_days: days,
  });

  if (result.response) return result.response;
  return liveResponse(result.data ?? {
    data: [],
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
    method: "trimmed_mean_live_daily_basket",
    trimLowerPct: 5,
    trimUpperPct: 95,
    minimumPresencePct: 0,
    currency: "CLP",
  });
}
