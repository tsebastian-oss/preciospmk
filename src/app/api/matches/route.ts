import { NextRequest, NextResponse } from "next/server";
import { supabaseRestWithCount } from "@/lib/supabase";

const SORTS: Record<string, string> = {
  gap_desc: "price_gap.desc,canonical_name.asc",
  savings_desc: "savings_pct.desc,price_gap.desc",
  price_asc: "best_price.asc,canonical_name.asc",
  updated_desc: "last_updated.desc,canonical_name.asc",
  name_asc: "canonical_name.asc",
};

function integer(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function safeSearch(value: string) {
  return value.replace(/[,*()]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const page = integer(params.get("page"), 1, 1, 10_000);
  const pageSize = integer(params.get("pageSize"), 20, 10, 50);
  const q = safeSearch(params.get("q") ?? "");
  const minSavings = integer(params.get("minSavings"), 0, 0, 100);
  const sort = SORTS[params.get("sort") ?? ""] ?? SORTS.gap_desc;

  const query: Record<string, string> = {
    select: "match_key,canonical_name,canonical_brand,category,listings,supermarkets,best_price,highest_price,average_price,price_gap,savings_pct,last_updated,best_supermarket,best_url,image_url,best_product_id,store_listings",
    order: sort,
    limit: String(pageSize),
    offset: String((page - 1) * pageSize),
  };

  if (q) {
    query.or = `(canonical_name.ilike.*${q}*,canonical_brand.ilike.*${q}*,category.ilike.*${q}*)`;
  }
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
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
