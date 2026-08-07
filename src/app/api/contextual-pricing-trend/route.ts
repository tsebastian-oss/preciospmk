import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type TrendPayload = {
  series: unknown[];
  currentDayObservations: number;
  latestObservationAt: string | null;
  scopeLabel?: string;
  mode?: string;
  autoSelected?: boolean;
  error?: string;
};

const RETAILER_TYPES = new Set(["supermarket", "department_store", "pharmacy"]);

function clean(value: string | null, max = 180) {
  return (value ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function days(value: string | null) {
  const parsed = Number(value);
  if (![7, 30, 90].includes(parsed)) return 30;
  return parsed;
}

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "overview");
  if (authorization.response) return authorization.response;

  const params = request.nextUrl.searchParams;
  const retailerTypeRaw = clean(params.get("retailerType"), 40);
  const retailerType = RETAILER_TYPES.has(retailerTypeRaw) ? retailerTypeRaw : null;
  const supermarket = clean(params.get("supermarket")) || null;
  const category = clean(params.get("category")) || null;
  const brand = clean(params.get("brand")) || null;
  const stockRaw = clean(params.get("stock"), 10);
  const stock = stockRaw === "in" || stockRaw === "out" ? stockRaw : "all";
  const requestedDays = days(params.get("days"));

  const result = await enterpriseRpc<TrendPayload>(request, "enterprise_contextual_pricing_trend", {
    p_organization_id: authorization.access?.organizationId,
    p_days: requestedDays,
    p_retailer_type: retailerType,
    p_supermarket: supermarket,
    p_category: category,
    p_brand: brand,
    p_stock: stock,
  });

  if (result.response) return result.response;

  return NextResponse.json(result.data ?? {
    series: [],
    currentDayObservations: 0,
    latestObservationAt: null,
    scopeLabel: "Sin datos para los filtros seleccionados",
    mode: "empty",
    autoSelected: true,
  }, {
    headers: {
      "cache-control": "private, no-store, max-age=0, must-revalidate",
      pragma: "no-cache",
      expires: "0",
    },
  });
}
