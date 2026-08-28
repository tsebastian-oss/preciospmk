import { NextRequest, NextResponse } from "next/server";
import { brandScopeAllows, enterpriseAccess } from "@/lib/enterprise-auth";
import { clickHouseConfigured, clickHouseQuery, type ClickHouseParams } from "@/lib/clickhouse";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Numeric = number | string;
type SummaryRow = {
  products: Numeric;
  retailers: Numeric;
  sellers: Numeric;
  in_stock_pct: Numeric;
  promo_pct: Numeric;
  last_observed_at: string | null;
};
type RetailerRow = {
  retailer: string;
  products: Numeric;
  in_stock: Numeric;
  min_price: Numeric;
  max_price: Numeric;
  last_observed_at: string | null;
};
type ProductRow = {
  id: string;
  external_id: string | null;
  name: string;
  category: string | null;
  url: string | null;
  image_url: string | null;
  supermarket: string;
  seller: string | null;
  regular_price: Numeric | null;
  current_price: Numeric;
  in_stock: boolean;
  observed_at: string;
};

const PRICE = "if(toFloat64(ifNull(s.offer_price, 0)) > 0, toFloat64(s.offer_price), toFloat64(ifNull(s.regular_price, 0)))";
const CATEGORY = "coalesce(nullIf(trimBoth(p.smart_category), ''), nullIf(trimBoth(p.category), ''))";

function num(value: Numeric | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function brandName(slug: string) {
  return slug === "victorinox" ? "Victorinox" : slug.replace(/(^|[-_ ])([a-z])/g, (_, a, b) => `${a}${b.toUpperCase()}`);
}

export async function GET(request: NextRequest) {
  const auth = await enterpriseAccess(request, "brand-panel");
  if (auth.response) return auth.response;
  if (!auth.access) return NextResponse.json({ error: "No fue posible resolver el acceso enterprise." }, { status: 500 });
  if (!clickHouseConfigured()) return NextResponse.json({ error: "ClickHouse no está configurado." }, { status: 503 });

  const slug = request.nextUrl.searchParams.get("brand")?.trim().toLowerCase().slice(0, 100) || "victorinox";
  if (!brandScopeAllows(auth.access, slug)) return NextResponse.json({ error: "Esta marca no está habilitada para tu cuenta." }, { status: 403 });
  const displayBrand = brandName(slug);
  const params: ClickHouseParams = { brand: { type: "String", value: slug } };
  const predicate = "lowerUTF8(ifNull(p.brand, '')) = {brand:String}";
  const started = Date.now();

  try {
    const [summaryRows, retailerRows, productRows] = await Promise.all([
      clickHouseQuery<SummaryRow>(`
        SELECT
          uniqExact(p.id) AS products,
          uniqExact(p.supermarket) AS retailers,
          uniqExactIf(ifNull(p.seller, ''), notEmpty(ifNull(p.seller, ''))) AS sellers,
          round(countIf(s.in_stock) / greatest(count(), 1) * 100, 1) AS in_stock_pct,
          round(countIf(toFloat64(ifNull(s.regular_price, 0)) > ${PRICE}) / greatest(count(), 1) * 100, 1) AS promo_pct,
          toString(max(s.observed_at)) AS last_observed_at
        FROM products AS p FINAL
        INNER JOIN product_latest_price_state AS s FINAL ON s.product_id = p.id
        WHERE ${predicate} AND ${PRICE} > 0
      `, params, 4_000),
      clickHouseQuery<RetailerRow>(`
        SELECT
          p.supermarket AS retailer,
          uniqExact(p.id) AS products,
          countIf(s.in_stock) AS in_stock,
          round(min(${PRICE}), 0) AS min_price,
          round(max(${PRICE}), 0) AS max_price,
          toString(max(s.observed_at)) AS last_observed_at
        FROM products AS p FINAL
        INNER JOIN product_latest_price_state AS s FINAL ON s.product_id = p.id
        WHERE ${predicate} AND ${PRICE} > 0
        GROUP BY p.supermarket
        ORDER BY products DESC
        LIMIT 30
      `, params, 4_000),
      clickHouseQuery<ProductRow>(`
        SELECT
          toString(p.id) AS id,
          p.external_id,
          p.name,
          ${CATEGORY} AS category,
          p.url,
          p.image_url,
          p.supermarket,
          p.seller,
          s.regular_price,
          ${PRICE} AS current_price,
          s.in_stock,
          toString(s.observed_at) AS observed_at
        FROM products AS p FINAL
        INNER JOIN product_latest_price_state AS s FINAL ON s.product_id = p.id
        WHERE ${predicate} AND ${PRICE} > 0
        ORDER BY s.observed_at DESC, p.supermarket ASC, p.name ASC
        LIMIT 160
      `, params, 5_000),
    ]);

    const summary = summaryRows[0];
    const products = productRows.map((row) => ({
      id: row.id,
      sku: row.external_id || null,
      ean: null,
      name: row.name,
      category: row.category || null,
      subcategory: null,
      url: row.url || null,
      imageUrl: row.image_url || null,
      attributes: {},
      lastSeenAt: row.observed_at,
    }));
    const listings = productRows.map((row) => ({
      id: `${row.id}:${row.supermarket}`,
      source: row.supermarket,
      domain: row.supermarket,
      title: row.name,
      seller: row.seller || null,
      category: row.category || null,
      url: row.url || "#",
      imageUrl: row.image_url || null,
      regularPrice: row.regular_price == null ? null : num(row.regular_price),
      currentPrice: num(row.current_price),
      currency: "CLP",
      inStock: Boolean(row.in_stock),
      rating: null,
      reviewCount: null,
      observedAt: row.observed_at,
    }));
    const sources = retailerRows.map((row, index) => ({
      id: `clickhouse:${row.retailer}`,
      retailer_name: row.retailer,
      domain: row.retailer,
      source_type: "retailer",
      priority: index + 1,
      last_crawled_at: row.last_observed_at,
      last_status: "ok:clickhouse",
      last_error: null,
      listings: num(row.products),
      in_stock: num(row.in_stock),
      min_price: num(row.min_price),
      max_price: num(row.max_price),
    }));

    return NextResponse.json({
      source: "clickhouse",
      generatedAt: new Date().toISOString(),
      queryMs: Date.now() - started,
      brand: {
        id: `clickhouse:${slug}`,
        slug,
        name: displayBrand,
        countryCode: "CL",
        officialUrl: slug === "victorinox" ? "https://www.victorinox.com/es-CL/" : "",
      },
      summary: {
        products: num(summary?.products),
        sources: num(summary?.retailers),
        listings: num(summary?.products),
        sellers: num(summary?.sellers),
        inStockPct: summary ? num(summary.in_stock_pct) : null,
        promoPct: summary ? num(summary.promo_pct) : null,
        lastObservedAt: summary?.last_observed_at ?? null,
      },
      sources,
      products,
      listings,
      lastRun: null,
    }, {
      headers: { "cache-control": "private, max-age=30, stale-while-revalidate=120" },
    });
  } catch (error) {
    console.error("brands-clickhouse-v3", error);
    return NextResponse.json({ error: "No fue posible cargar Brands desde ClickHouse." }, { status: 503 });
  }
}
