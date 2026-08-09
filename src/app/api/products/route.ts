import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, enterpriseRpc, scopeAllows } from "@/lib/enterprise-auth";

const RETAILERS = new Set([
  "Lider",
  "Jumbo",
  "Santa Isabel",
  "Unimarc",
  "Paris",
  "Falabella",
  "Ripley",
  "Salcobrand",
  "Cruz Verde",
  "Farmacias Ahumada",
]);

const RETAILER_TYPES = new Set(["supermarket", "department_store", "pharmacy"]);
const STOCK_FILTERS = new Set(["all", "in", "out"]);
const SORTS = new Set(["price_asc", "price_desc", "discount_desc", "newest", "updated_desc", "name_asc"]);

type ProductPagePayload = {
  products: unknown[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  organizationId: string;
  industrySlug: string | null;
  appliedFilters: Record<string, unknown>;
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
  const requestedRetailer = params.get("supermarket") ?? "";
  const retailer = RETAILERS.has(requestedRetailer) ? requestedRetailer : "";
  const requestedRetailerType = params.get("retailerType") ?? "";
  const retailerType = RETAILER_TYPES.has(requestedRetailerType) ? requestedRetailerType : "";
  const category = safeFilter(params.get("category") ?? "");
  const brand = safeFilter(params.get("brand") ?? "");
  const requestedStock = params.get("stock") ?? "all";
  const stock = STOCK_FILTERS.has(requestedStock) ? requestedStock : "all";
  const requestedSort = params.get("sort") ?? "updated_desc";
  const sort = SORTS.has(requestedSort) ? requestedSort : "updated_desc";

  if (retailer && !scopeAllows(access, "retailers", retailer)) {
    return NextResponse.json({ error: "Ese retailer no pertenece al alcance contratado." }, { status: 403 });
  }
  if (category && !scopeAllows(access, "categories", category)) {
    return NextResponse.json({ error: "Esa categoría no pertenece al alcance contratado." }, { status: 403 });
  }
  if (brand && !scopeAllows(access, "brands", brand)) {
    return NextResponse.json({ error: "Esa marca no pertenece al alcance contratado." }, { status: 403 });
  }

  const result = await enterpriseRpc<ProductPagePayload>(request, "enterprise_products_page", {
    p_organization_id: access.organizationId,
    p_page: page,
    p_page_size: pageSize,
    p_query: q || null,
    p_retailer_type: retailerType || null,
    p_retailer: retailer || null,
    p_category: category || null,
    p_brand: brand || null,
    p_stock: stock,
    p_offer_only: offerOnly,
    p_sort: sort,
  });
  if (result.response) return result.response;

  const payload = result.data ?? {
    products: [],
    page,
    pageSize,
    total: 0,
    totalPages: 1,
    organizationId: access.organizationId,
    industrySlug: access.industrySlug,
    appliedFilters: { q, retailerType, retailer, category, brand, stock, offerOnly },
  };

  return NextResponse.json({ ...payload, industryName: access.industryName });
}
