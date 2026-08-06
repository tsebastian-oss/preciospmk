import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, enterpriseRpc, scopeAllows } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CategoryOption = {
  value: string;
  label: string;
  products: number;
  retailers: number;
};

type ProductOption = {
  id: string;
  externalId: string;
  name: string;
  brand: string | null;
  supermarket: string;
  category: string;
  industrySlug: string | null;
};

type FilterOptions = {
  industrySlug: string | null;
  aiFiltered: boolean;
  retailer: string | null;
  category: string | null;
  categories: CategoryOption[];
  products: ProductOption[];
  productCount: number;
  truncated: boolean;
  limit: number;
};

function noStore<T>(payload: T, init?: ResponseInit) {
  return NextResponse.json(payload, {
    ...init,
    headers: {
      "cache-control": "private, no-store, max-age=0, must-revalidate",
      pragma: "no-cache",
      expires: "0",
      ...(init?.headers ?? {}),
    },
  });
}

function clean(value: string | null, max: number) {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed.slice(0, max) : null;
}

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "overview");
  if (authorization.response) return authorization.response;
  const access = authorization.access!;

  const retailer = clean(request.nextUrl.searchParams.get("supermarket"), 120);
  const category = clean(request.nextUrl.searchParams.get("category"), 240);
  const search = clean(request.nextUrl.searchParams.get("q"), 160);
  const parsedLimit = Number(request.nextUrl.searchParams.get("limit") ?? 800);
  const limit = Number.isInteger(parsedLimit) ? Math.max(50, Math.min(parsedLimit, 2500)) : 800;

  if (retailer && !scopeAllows(access, "retailers", retailer)) {
    return noStore({ error: "La cadena seleccionada no pertenece al alcance contratado." }, { status: 403 });
  }

  const result = await enterpriseRpc<FilterOptions>(request, "enterprise_export_filter_options", {
    p_organization_id: access.organizationId,
    p_retailer: retailer,
    p_category: category,
    p_search: search,
    p_limit: limit,
  });
  if (result.response) return result.response;

  return noStore({
    filters: result.data ?? {
      industrySlug: access.industrySlug,
      aiFiltered: true,
      retailer,
      category,
      categories: [],
      products: [],
      productCount: 0,
      truncated: false,
      limit,
    },
    industrySlug: access.industrySlug,
    industryName: access.industryName,
  });
}
