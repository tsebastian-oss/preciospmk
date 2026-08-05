import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, scopeAllows } from "@/lib/enterprise-auth";
import { supabaseRestWithCount } from "@/lib/supabase";

const SUPERMARKETS = new Set(["Lider", "Jumbo", "Santa Isabel"]);
const SORTS: Record<string, string> = {
  price_asc: "in_stock.desc,offer_price.asc,name.asc",
  price_desc: "in_stock.desc,offer_price.desc,name.asc",
  discount_desc: "discount_pct.desc,savings.desc,in_stock.desc,name.asc",
  newest: "observed_at.desc,in_stock.desc,name.asc",
  name_asc: "name.asc,in_stock.desc",
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

function inFilter(values: string[]) {
  const clean = values.map((item) => item.replace(/["(),]/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
  return `in.(${clean.map((item) => `"${item}"`).join(",")})`;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const offerOnly = params.get("offerOnly") === "true";
  const authorization = await enterpriseAccess(request, offerOnly ? "promotions" : "products");
  if (authorization.response) return authorization.response;
  const access = authorization.access!;

  if (access.organizationType === "brand" && access.brands.length === 0 && !access.isSaasAdmin) {
    return NextResponse.json({ error: "La organización todavía no tiene marcas configuradas." }, { status: 403 });
  }

  const page = integer(params.get("page"), 1, 1, 10_000);
  const pageSize = integer(params.get("pageSize"), 25, 10, 50);
  const q = safeSearch(params.get("q") ?? "");
  const requestedSupermarket = params.get("supermarket") ?? "";
  const supermarket = SUPERMARKETS.has(requestedSupermarket) ? requestedSupermarket : "";
  const category = safeFilter(params.get("category") ?? "");
  const stock = params.get("stock") ?? "all";
  const sort = SORTS[params.get("sort") ?? ""] ?? SORTS.price_asc;

  if (supermarket && !scopeAllows(access, "retailers", supermarket)) {
    return NextResponse.json({ error: "Ese retailer no pertenece al alcance contratado." }, { status: 403 });
  }
  if (category && !scopeAllows(access, "categories", category)) {
    return NextResponse.json({ error: "Esa categoría no pertenece al alcance contratado." }, { status: 403 });
  }

  const query: Record<string, string> = {
    select: "id,supermarket,external_id,name,brand,category,url,image_url,regular_price,offer_price,unit,unit_price,in_stock,observed_at,savings,discount_pct",
    order: sort,
    limit: String(pageSize),
    offset: String((page - 1) * pageSize),
  };

  if (q) query.or = `(name.ilike.*${q}*,brand.ilike.*${q}*,external_id.ilike.*${q}*)`;
  if (supermarket) query.supermarket = `eq.${supermarket}`;
  else if (!access.isSaasAdmin && access.retailers.length > 0) query.supermarket = inFilter(access.retailers);

  if (category) query.category = `eq.${category}`;
  else if (!access.isSaasAdmin && access.categories.length > 0) query.category = inFilter(access.categories);

  if (!access.isSaasAdmin && access.brands.length > 0) query.brand = inFilter(access.brands);
  if (stock === "in") query.in_stock = "eq.true";
  if (stock === "out") query.in_stock = "eq.false";
  if (offerOnly) query.discount_pct = "gt.0";

  try {
    const result = await supabaseRestWithCount<unknown[]>("dashboard_products", { query });
    const total = result.count ?? result.data.length;
    return NextResponse.json({
      products: result.data,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      organizationId: access.organizationId,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
