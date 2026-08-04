import { NextRequest, NextResponse } from "next/server";
import { supabaseRestWithCount } from "@/lib/supabase";

const SUPERMARKETS = new Set(["Lider", "Jumbo", "Santa Isabel"]);
const SORTS: Record<string, string> = {
  price_asc: "offer_price.asc,name.asc",
  price_desc: "offer_price.desc,name.asc",
  discount_desc: "discount_pct.desc,savings.desc,name.asc",
  newest: "observed_at.desc,name.asc",
  name_asc: "name.asc",
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
  return value.replace(/[,()]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const page = integer(params.get("page"), 1, 1, 10_000);
  const pageSize = integer(params.get("pageSize"), 25, 10, 50);
  const q = safeSearch(params.get("q") ?? "");
  const requestedSupermarket = params.get("supermarket") ?? "";
  const supermarket = SUPERMARKETS.has(requestedSupermarket)
    ? requestedSupermarket
    : "";
  const category = safeFilter(params.get("category") ?? "");
  const stock = params.get("stock") ?? "all";
  const offerOnly = params.get("offerOnly") === "true";
  const sort = SORTS[params.get("sort") ?? ""] ?? SORTS.price_asc;

  const query: Record<string, string> = {
    select: "id,supermarket,external_id,name,brand,category,url,image_url,regular_price,offer_price,unit,unit_price,in_stock,observed_at,savings,discount_pct",
    order: sort,
    limit: String(pageSize),
    offset: String((page - 1) * pageSize),
  };

  if (q) {
    query.or = `(name.ilike.*${q}*,brand.ilike.*${q}*,external_id.ilike.*${q}*)`;
  }
  if (supermarket) query.supermarket = `eq.${supermarket}`;
  if (category) query.category = `eq.${category}`;
  if (stock === "in") query.in_stock = "eq.true";
  if (stock === "out") query.in_stock = "eq.false";
  if (offerOnly) query.discount_pct = "gt.0";

  try {
    const result = await supabaseRestWithCount<unknown[]>("dashboard_products", {
      query,
    });
    const total = result.count ?? result.data.length;

    return NextResponse.json({
      products: result.data,
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
