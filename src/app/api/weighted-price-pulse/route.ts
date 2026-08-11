import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type WeightedPricePulsePayload = {
  data: Array<{
    supermarket: string;
    variationPct: number | null;
    weightedCurrent: number | null;
    weightedPrevious: number | null;
    matchedSkus: number;
    currentSkus: number;
    previousSkus: number;
    coveragePct: number | null;
    status: "ready" | "building";
    confidence: "high" | "medium" | "low" | "building";
    latestObservationAt: string | null;
  }>;
  asOfDate: string | null;
  previousDate: string | null;
  partialDay: boolean;
  latestObservationAt: string | null;
  method: string;
  weighting: string;
  outlierTreatment: string;
  currency: string;
  error?: string;
};

const fallback: WeightedPricePulsePayload = {
  data: [],
  asOfDate: null,
  previousDate: null,
  partialDay: true,
  latestObservationAt: null,
  method: "matched_sku_value_weighted_index",
  weighting: "previous_day_sku_value",
  outlierTreatment: "2.5_97.5_percentile_and_0.5_2.0_relative_bounds",
  currency: "CLP",
};

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "overview");
  if (authorization.response) return authorization.response;

  const result = await enterpriseRpc<WeightedPricePulsePayload>(request, "enterprise_weighted_price_pulse", {
    p_organization_id: authorization.access?.organizationId,
  });
  if (result.response) return result.response;

  return NextResponse.json(result.data ?? fallback, {
    headers: {
      "cache-control": "private, max-age=60, stale-while-revalidate=120",
    },
  });
}
