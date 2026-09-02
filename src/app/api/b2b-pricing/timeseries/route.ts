import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type TimeSeriesPayload = {
  layer?: string;
  summary?: Record<string, unknown>;
  options?: Record<string, unknown>;
  points?: unknown[];
};

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "overview");
  if (authorization.response) return authorization.response;

  const url = new URL(request.url);
  const category = (url.searchParams.get("category") || "courier").trim().slice(0, 80);
  const requestedDays = Number(url.searchParams.get("days") || 365);
  const days = Number.isFinite(requestedDays)
    ? Math.max(30, Math.min(1095, Math.round(requestedDays)))
    : 365;
  const requestedLayer = (url.searchParams.get("layer") || "b2b").trim().toLowerCase();
  const layer = requestedLayer === "b2c" ? "b2c" : "b2b";

  const result = await enterpriseRpc<TimeSeriesPayload>(request, "b2b_pricing_timeseries", {
    p_category: category,
    p_days: days,
    p_layer: layer,
  });
  if (result.response) return result.response;

  return NextResponse.json(
    result.data ?? { layer, summary: {}, options: {}, points: [] },
    { headers: { "cache-control": "private, no-store, max-age=0" } },
  );
}
