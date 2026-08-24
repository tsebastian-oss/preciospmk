import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type NormalizedPayload = {
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
};

const EMPTY_NORMALIZED: NormalizedPayload = { summary: {}, profiles: [], rows: [] };

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "overview");
  if (authorization.response) return authorization.response;

  const url = new URL(request.url);
  const category = (url.searchParams.get("category") || "courier").trim().slice(0, 80);
  const requestedDays = Number(url.searchParams.get("days") || 365);
  const days = Number.isFinite(requestedDays) ? Math.max(30, Math.min(1095, Math.round(requestedDays))) : 365;

  const result = await enterpriseRpc<DashboardPayload>(request, "b2b_pricing_dashboard", {
    p_category: category,
    p_days: days,
  });
  if (result.response) return result.response;

  const normalizedResult = await enterpriseRpc<NormalizedPayload>(request, "b2b_pricing_comparables", {
    p_category: category,
    p_days: days,
  });
  if (normalizedResult.response) return normalizedResult.response;

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
    normalized: normalizedResult.data ?? EMPTY_NORMALIZED,
  }, { headers: { "cache-control": "private, no-store, max-age=0" } });
}
