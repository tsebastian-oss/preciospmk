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
  coverage?: Record<string, unknown>;
  zones?: unknown[];
  regions?: unknown[];
  notes?: string[];
};

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "overview");
  if (authorization.response) return authorization.response;

  const url = new URL(request.url);
  const requestedDays = Number(url.searchParams.get("days") || 30);
  const days = Number.isFinite(requestedDays)
    ? Math.max(1, Math.min(365, Math.round(requestedDays)))
    : 30;

  const requestedWeight = Number(url.searchParams.get("weight") || 0.5);
  const weight = [0.5, 3, 6].includes(requestedWeight) ? requestedWeight : 0.5;

  const requestedService = url.searchParams.get("service") || "Estándar";
  const service = ["Básico", "Estándar", "Prioritario"].includes(requestedService)
    ? requestedService
    : "Estándar";

  const result = await enterpriseRpc<RegionalPayload>(
    request,
    "chilexpress_b2c_region_dashboard_v2",
    { p_days: days, p_weight: weight, p_service: service },
  );
  if (result.response) return result.response;

  return NextResponse.json(result.data ?? {
    origin: "Santiago Centro",
    weightKg: weight,
    delivery: "Domicilio",
    service,
    providers: ["Chilexpress", "Starken", "Blue Express", "CorreosChile"],
    coverage: { completeRegions: 0, totalRegions: 16, latestDate: null },
    zones: [],
    regions: [],
    notes: [],
  }, { headers: { "cache-control": "private, no-store, max-age=0" } });
}
