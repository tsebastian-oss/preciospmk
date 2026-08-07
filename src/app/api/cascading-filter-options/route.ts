import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CascadeOption = { value: string; products: number };
type CascadePayload = {
  retailerType: string;
  supermarket: string | null;
  category: string | null;
  brand: string | null;
  chains: CascadeOption[];
  categories: CascadeOption[];
  brands: CascadeOption[];
  stock: { in: number; out: number };
};

function clean(value: string | null, max = 180) {
  return (value ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "overview");
  if (authorization.response) return authorization.response;

  const params = request.nextUrl.searchParams;
  const retailerType = clean(params.get("retailerType"), 40) || "all";
  const supermarket = clean(params.get("supermarket"));
  const category = clean(params.get("category"));
  const brand = clean(params.get("brand"));

  const result = await enterpriseRpc<CascadePayload>(request, "enterprise_cascading_filter_options", {
    p_organization_id: authorization.access?.organizationId,
    p_retailer_type: retailerType,
    p_supermarket: supermarket || null,
    p_category: category || null,
    p_brand: brand || null,
  });
  if (result.response) return result.response;

  return NextResponse.json(result.data ?? {
    retailerType,
    supermarket: supermarket || null,
    category: category || null,
    brand: brand || null,
    chains: [],
    categories: [],
    brands: [],
    stock: { in: 0, out: 0 },
  }, {
    headers: {
      "cache-control": "private, no-store, max-age=0, must-revalidate",
      pragma: "no-cache",
      expires: "0",
    },
  });
}
