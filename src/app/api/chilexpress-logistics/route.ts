import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type LogisticsPayload = {
  generatedAt?: string;
  organizationId?: string;
  runs?: unknown[];
  b2cRates?: unknown[];
  b2bProcesses?: unknown[];
  b2bDocuments?: unknown[];
  b2bRates?: unknown[];
};

export async function GET(request: NextRequest) {
  const auth = await enterpriseAccess(request, "overview");
  if (auth.response) return auth.response;
  if (!auth.access) return NextResponse.json({ error: "No fue posible resolver el acceso." }, { status: 500 });

  const isChilexpress = auth.access.organizationName.localeCompare("Chilexpress", "es", { sensitivity: "base" }) === 0
    || auth.access.brands.some((brand) => brand.localeCompare("Chilexpress", "es", { sensitivity: "base" }) === 0);

  if (!isChilexpress && !auth.access.isSaasAdmin) {
    return NextResponse.json({ error: "Esta cuenta no tiene acceso al workspace Chilexpress." }, { status: 403 });
  }

  const requestedDays = Number(request.nextUrl.searchParams.get("days") || 365);
  const days = Number.isFinite(requestedDays) ? Math.max(30, Math.min(1095, Math.round(requestedDays))) : 365;

  const result = await enterpriseRpc<LogisticsPayload>(request, "chilexpress_logistics_payload", { p_days: days });
  if (result.response) return result.response;

  return NextResponse.json(result.data ?? {
    generatedAt: new Date().toISOString(),
    runs: [],
    b2cRates: [],
    b2bProcesses: [],
    b2bDocuments: [],
    b2bRates: [],
  }, { headers: { "cache-control": "private, no-store, max-age=0" } });
}
