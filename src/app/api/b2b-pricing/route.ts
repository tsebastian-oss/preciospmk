import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type NormalizedPayload = {
  layer?: string;
  summary: Record<string, unknown>;
  profiles: unknown[];
  rows: unknown[];
};

type DashboardPayload = {
  category: string;
  days: number;
  summary: Record<string, unknown>;
  providers: unknown[];
  services: unknown[];
  recent: unknown[];
  source: string;
  normalized?: NormalizedPayload;
  annexes?: Record<string, unknown>;
};

const EMPTY_NORMALIZED: NormalizedPayload = { summary: {}, profiles: [], rows: [] };

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "overview");
  if (authorization.response) return authorization.response;

  const url = new URL(request.url);
  const category = (url.searchParams.get("category") || "courier").trim().slice(0, 80);
  const requestedDays = Number(url.searchParams.get("days") || 365);
  const days = Number.isFinite(requestedDays) ? Math.max(30, Math.min(1095, Math.round(requestedDays))) : 365;
  const requestedLayer = (url.searchParams.get("layer") || "public").trim().toLowerCase();
  const layer = requestedLayer === "b2b" || requestedLayer === "best" ? requestedLayer : "public";

  const result = await enterpriseRpc<DashboardPayload>(request, "b2b_pricing_dashboard", {
    p_category: category,
    p_days: days,
  });
  if (result.response) return result.response;

  const normalizedResult = await enterpriseRpc<NormalizedPayload>(request, "b2b_pricing_comparables_v2", {
    p_category: category,
    p_days: days,
    p_layer: layer,
  });
  if (normalizedResult.response) return normalizedResult.response;

  const annexResult = await enterpriseRpc<Record<string, unknown>>(request, "b2b_annex_extraction_summary", { p_days: days });
  if (annexResult.response) return annexResult.response;

  const base = result.data ?? {
    category,
    days,
    summary: {},
    providers: [],
    services: [],
    recent: [],
    source: "mercado_publico_ocds",
  };

  return NextResponse.json({
    ...base,
    layer,
    normalized: normalizedResult.data ?? { ...EMPTY_NORMALIZED, layer },
    annexes: annexResult.data ?? {},
  }, { headers: { "cache-control": "private, no-store, max-age=0" } });
}
