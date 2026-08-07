import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, enterpriseRpc, scopeAllows } from "@/lib/enterprise-auth";

const SORTS = new Set(["gap_desc", "savings_desc", "price_asc", "updated_desc", "name_asc"]);

function integer(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function safeSearch(value: string) {
  return value.replace(/[,*()]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

function safeFilter(value: string) {
  return value.replace(/[,()]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
}

type MatchesPayload = {
  matches: unknown[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  coverage: "full" | "partial";
  quality: "exact" | "expanded";
  matchingModel: string;
  requiredChains: string[];
  organizationId: string;
  appliedFilters: Record<string, unknown>;
};

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "pricing");
  if (authorization.response) return authorization.response;
  const access = authorization.access!;

  const params = request.nextUrl.searchParams;
  const page = integer(params.get("page"), 1, 1, 10_000);
  const pageSize = integer(params.get("pageSize"), 20, 10, 50);
  const q = safeSearch(params.get("q") ?? "");
  const category = safeFilter(params.get("category") ?? "");
  const brand = safeFilter(params.get("brand") ?? "");
  const minSavings = integer(params.get("minSavings"), 0, 0, 100);
  const coverage = params.get("coverage") === "partial" ? "partial" : "full";
  const quality = params.get("quality") === "exact" ? "exact" : "expanded";
  const requestedSort = params.get("sort") ?? "gap_desc";
  const sort = SORTS.has(requestedSort) ? requestedSort : "gap_desc";

  if (category && !scopeAllows(access, "categories", category)) {
    return NextResponse.json({ error: "Esa categoría no pertenece al alcance contratado." }, { status: 403 });
  }
  if (brand && !scopeAllows(access, "brands", brand)) {
    return NextResponse.json({ error: "Esa marca no pertenece al alcance contratado." }, { status: 403 });
  }

  const result = await enterpriseRpc<MatchesPayload>(request, "enterprise_price_matches", {
    p_organization_id: access.organizationId,
    p_page: page,
    p_page_size: pageSize,
    p_query: q || null,
    p_category: category || null,
    p_brand: brand || null,
    p_min_savings: minSavings,
    p_coverage: coverage,
    p_quality: quality,
    p_sort: sort,
  });

  if (result.response) return result.response;
  return NextResponse.json(result.data ?? {
    matches: [],
    page,
    pageSize,
    total: 0,
    totalPages: 1,
    coverage,
    quality,
    matchingModel: quality === "exact" ? "exact" : "exact_plus_hybrid_ai",
    requiredChains: coverage === "full" ? ["Lider", "Jumbo", "Santa Isabel"] : [],
    organizationId: access.organizationId,
    appliedFilters: { q, category, brand, minSavings },
  });
}
