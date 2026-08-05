import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";

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
  partialDay: boolean;
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

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "overview");
  if (authorization.response) return authorization.response;

  const days = clampDays(request.nextUrl.searchParams.get("days"));
  const result = await enterpriseRpc<DailyPricingPayload>(request, "enterprise_daily_pricing_trend", {
    p_organization_id: authorization.access?.organizationId,
    p_days: days,
  });

  if (result.response) return result.response;
  return NextResponse.json(result.data ?? {
    data: [],
    daysRequested: days,
    availableDays: 0,
    firstDate: null,
    lastDate: null,
    refreshedAt: null,
    partialDay: false,
    method: "trimmed_mean_stable_basket",
    trimLowerPct: 5,
    trimUpperPct: 95,
    minimumPresencePct: 60,
    currency: "CLP",
  });
}
