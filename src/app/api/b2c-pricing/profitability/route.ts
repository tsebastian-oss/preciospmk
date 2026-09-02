import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RegionalPayload = {
  origin?: string;
  weightKg?: number;
  delivery?: string;
  service?: string;
  providers?: string[];
  slaMap?: Record<string,string>;
  regions?: Array<Record<string,unknown>>;
  zones?: Array<Record<string,unknown>>;
  coverage?: Record<string,unknown>;
  notes?: string[];
};

type HistoryPayload = {
  weightKg?: number;
  rows?: Array<Record<string,unknown>>;
};

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "overview");
  if (authorization.response) return authorization.response;

  const rawWeight = Number(request.nextUrl.searchParams.get("weight") ?? "0.5");
  const weight = [0.5, 3, 6].includes(rawWeight) ? rawWeight : 0.5;

  const [snapshotResult, historyResult] = await Promise.all([
    enterpriseRpc<RegionalPayload>(
      request,
      "chilexpress_b2c_region_dashboard_v2",
      { p_days: 365, p_weight: weight, p_service: "Estándar" },
    ),
    enterpriseRpc<HistoryPayload>(
      request,
      "chilexpress_profitability_history",
      { p_days: 365, p_weight: weight },
    ),
  ]);

  if (snapshotResult.response) return snapshotResult.response;
  if (historyResult.response) return historyResult.response;

  return NextResponse.json({
    weightKg: weight,
    service: "Estándar",
    snapshot: snapshotResult.data ?? null,
    history: historyResult.data?.rows ?? [],
    observedPriceNotice: "Precios competitivos observados/oficiales. Costos, densidad y márgenes son estimaciones del modelo.",
  }, {
    headers: { "cache-control": "private, no-store" },
  });
}
