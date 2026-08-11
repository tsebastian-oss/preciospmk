import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type FilterPayload = {
  defaults: string[];
  categories: Array<{ id: string; label: string; kind: "group" | "smart"; products: number; retailers: number }>;
  brands: Array<{ id: string; label: string; kind: "brand"; products: number; retailers: number }>;
  maxSeries: number;
  industrySlug: string | null;
};

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "overview");
  if (authorization.response) return authorization.response;

  const result = await enterpriseRpc<FilterPayload>(request, "enterprise_daily_pricing_filter_options", {
    p_organization_id: authorization.access?.organizationId,
  });
  if (result.response) return result.response;

  return NextResponse.json(result.data ?? {
    defaults: ["group:non_alcoholic", "group:grocery", "group:alcoholic"],
    categories: [],
    brands: [],
    maxSeries: 8,
    industrySlug: authorization.access?.industrySlug ?? null,
  }, {
    headers: {
      "cache-control": "private, max-age=60, stale-while-revalidate=300",
    },
  });
}
