import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, scopeAllows } from "@/lib/enterprise-auth";
import { supabaseRestWithCount } from "@/lib/supabase";

const SORTS: Record<string, string> = {
  gap_desc: "supermarkets.desc,match_confidence.desc,price_gap.desc,canonical_name.asc",
  savings_desc: "supermarkets.desc,match_confidence.desc,savings_pct.desc,price_gap.desc",
  price_asc: "supermarkets.desc,match_confidence.desc,best_price.asc,canonical_name.asc",
  updated_desc: "supermarkets.desc,match_confidence.desc,last_updated.desc,canonical_name.asc",
  name_asc: "supermarkets.desc,match_confidence.desc,canonical_name.asc",
};

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

function inFilter(values: string[]) {
  const clean = values.map((item) => item.replace(/["(),]/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
  return `in.(${clean.map((item) => `"${item}"`).join(",")})`;
}

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
  const sort = SORTS[params.get("sort") ?? ""] ?? SORTS.gap_desc;

  if (category && !scopeAllows(access, "categories", category)) {
    return NextResponse.json({ error: "Esa categoría no pertenece al alcance contratado." }, { status: 403 });
  }
  if (brand && !scopeAllows(access, "brands", brand)) {
    return NextResponse.json({ error: "Esa marca no pertenece al alcance contratado." }, { status: 403 });
  }

  const query: Record<string, string> = {
    select: "match_key,canonical_name,canonical_brand,category,smart_category,listings,supermarkets,best_price,highest_price,average_price,price_gap,savings_pct,last_updated,match_method,match_confidence,best_supermarket,best_url,image_url,best_product_id,store_listings",
    order: sort,
    limit: String(pageSize),
    offset: String((page - 1) * pageSize),
    supermarkets: coverage === "full" ? "eq.3" : "gte.2",
  };

  if (quality === "exact") query.match_method = "eq.exact";
  if (q) query.or = `(canonical_name.ilike.*${q}*,canonical_brand.ilike.*${q}*,category.ilike.*${q}*,smart_category.ilike.*${q}*)`;
  if (category) query.smart_category = `eq.${category}`;
  else if (!access.isSaasAdmin && access.categories.length > 0) query.smart_category = inFilter(access.categories);
  if (brand) query.canonical_brand = `eq.${brand}`;
  else if (!access.isSaasAdmin && access.brands.length > 0) query.canonical_brand = inFilter(access.brands);
  if (minSavings > 0) query.savings_pct = `gte.${minSavings}`;

  try {
    const result = await supabaseRestWithCount<unknown[]>("product_match_summary", { query });
    const total = result.count ?? result.data.length;
    return NextResponse.json({
      matches: result.data,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      coverage,
      quality,
      matchingModel: quality === "exact" ? "exact" : "exact_plus_hybrid_ai",
      requiredChains: coverage === "full" ? ["Lider", "Jumbo", "Santa Isabel"] : [],
      organizationId: access.organizationId,
      appliedFilters: { q, category, brand, minSavings },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
