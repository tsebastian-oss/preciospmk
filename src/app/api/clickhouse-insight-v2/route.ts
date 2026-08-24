import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, enterpriseRest, enterpriseRpc } from "@/lib/enterprise-auth";
import { clickHouseConfigured } from "@/lib/clickhouse";
import { clickHouseInsight } from "@/lib/clickhouse-insights";
import { clickHouseInsightV2, insightV2BrandOptions, type InsightV2Mode } from "@/lib/clickhouse-insights-v2";
import { fullHistoryProductOptions } from "@/lib/clickhouse-full-history-products";
import { fullHistoryEvolution } from "@/lib/clickhouse-full-history-evolution";
import { fullHistoryAlerts } from "@/lib/clickhouse-full-history-alerts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const V2 = new Set<InsightV2Mode>(["price-evolution", "price-gaps", "price-alerts", "products", "data-status"]);
// While there are no paying customers, default to the Supabase-backed demo snapshot.
// Set CLICKHOUSE_DEMO_MODE=false when ClickHouse should become the live analytics source again.
const DEMO_MODE = process.env.CLICKHOUSE_DEMO_MODE !== "false";

function days(value: string | null) {
  const parsed = Number(value ?? 30);
  return [7, 30, 90, 180].includes(parsed) ? parsed : 30;
}

function trendDays(value: number) {
  if (value <= 30) return 30;
  if (value <= 60) return 60;
  return 90;
}

type FilterOption = { id?: string; label?: string; products?: number };
type FilterPayload = { brands?: FilterOption[] };
type DashboardStore = {
  supermarket?: string;
  products?: number;
  in_stock?: number;
  offers?: number;
  average_price?: number;
  last_updated?: string | null;
};
type DashboardPayload = {
  supermarkets?: DashboardStore[];
  topOffers?: Array<Record<string, unknown>>;
};
type BrandRetailer = {
  retailer?: string;
  skus?: number;
  inStock?: number;
  availabilityPct?: number;
  medianPrice?: number;
  averagePrice?: number;
  minPrice?: number;
  maxPrice?: number;
  lastObservedAt?: string | null;
};
type BrandContext = { current?: { retailers?: BrandRetailer[] } };
type TrendPayload = {
  series?: Array<{
    label?: string;
    points?: Array<{ date?: string; price?: number | null; skus?: number | null }>;
  }>;
};
type DashboardProduct = {
  id: string;
  supermarket: string;
  name: string;
  brand: string | null;
  category: string | null;
  regular_price: number | null;
  offer_price: number | null;
  in_stock: boolean;
  observed_at: string | null;
  url: string | null;
  retailer_type?: string | null;
};

type DemoRetailer = {
  retailer: string;
  products: number;
  medianPrice: number;
  averagePrice: number;
  minPrice: number;
  maxPrice: number;
  inStock: number;
  availabilityPct: number;
  lastObservedAt: string | null;
};

async function rpcData<T>(request: NextRequest, name: string, body: Record<string, unknown>) {
  const result = await enterpriseRpc<T>(request, name, body);
  return result.response ? undefined : result.data;
}

async function demoBrands(request: NextRequest, organizationId: string) {
  const filters = await rpcData<FilterPayload>(request, "enterprise_daily_pricing_filter_options", {
    p_organization_id: organizationId,
  });
  return (filters?.brands ?? [])
    .map((item) => ({
      value: (item.label ?? item.id ?? "").replace(/^brand:/, ""),
      products: Number(item.products ?? 0),
    }))
    .filter((item) => item.value);
}

async function demoProducts(request: NextRequest, brand: string, limit = 120, offset = 0, query = "") {
  const safeQuery = query.replace(/[(),]/g, " ").trim();
  const rest = await enterpriseRest<DashboardProduct[]>(request, "dashboard_products", {
    query: {
      select: "id,supermarket,name,brand,category,regular_price,offer_price,in_stock,observed_at,url,retailer_type",
      ...(brand ? { brand: `eq.${brand}` } : {}),
      ...(safeQuery ? { or: `(name.ilike.*${safeQuery}*,brand.ilike.*${safeQuery}*,category.ilike.*${safeQuery}*,supermarket.ilike.*${safeQuery}*)` } : {}),
      order: "observed_at.desc",
      limit: String(limit),
      offset: String(offset),
    },
  });
  return rest.response ? [] : (rest.data ?? []);
}

function retailerRows(dashboard?: DashboardPayload, brandContext?: BrandContext): DemoRetailer[] {
  const scoped = brandContext?.current?.retailers ?? [];
  if (scoped.length) {
    return scoped.map((row) => ({
      retailer: row.retailer ?? "Retailer",
      products: Number(row.skus ?? 0),
      medianPrice: Number(row.medianPrice ?? row.averagePrice ?? 0),
      averagePrice: Number(row.averagePrice ?? row.medianPrice ?? 0),
      minPrice: Number(row.minPrice ?? row.medianPrice ?? 0),
      maxPrice: Number(row.maxPrice ?? row.medianPrice ?? 0),
      inStock: Number(row.inStock ?? 0),
      availabilityPct: Number(row.availabilityPct ?? 0),
      lastObservedAt: row.lastObservedAt ?? null,
    }));
  }
  return (dashboard?.supermarkets ?? []).map((row) => {
    const products = Number(row.products ?? 0);
    const inStock = Number(row.in_stock ?? 0);
    const price = Number(row.average_price ?? 0);
    return {
      retailer: row.supermarket ?? "Retailer",
      products,
      medianPrice: price,
      averagePrice: price,
      minPrice: price,
      maxPrice: price,
      inStock,
      availabilityPct: products > 0 ? Math.round((inStock / products) * 1000) / 10 : 0,
      lastObservedAt: row.last_updated ?? null,
    };
  });
}

async function demoResponse(request: NextRequest, organizationId: string) {
  const params = request.nextUrl.searchParams;
  const optionMode = params.get("options");
  const selectedBrand = params.get("brand") ?? "";
  const requestedDays = days(params.get("days"));

  if (optionMode === "brands") {
    return NextResponse.json({ source: "clickhouse", demoMode: true, dataSource: "supabase-demo", brands: await demoBrands(request, organizationId) });
  }

  if (optionMode === "products") {
    const rows = selectedBrand ? await demoProducts(request, selectedBrand) : [];
    return NextResponse.json({
      source: "clickhouse",
      demoMode: true,
      dataSource: "supabase-demo",
      products: rows.map((row) => ({
        id: row.id,
        name: row.name,
        brand: row.brand ?? selectedBrand,
        retailer: row.supermarket,
        latestPrice: Number(row.offer_price ?? row.regular_price ?? 0),
        lastObservedAt: row.observed_at,
        availableDays: 0,
      })),
    });
  }

  const mode = (params.get("mode") ?? "price-evolution") as InsightV2Mode;
  const generatedAt = new Date().toISOString();

  if (mode === "price-evolution") {
    const selectedSeries = selectedBrand ? [`brand:${selectedBrand}`] : undefined;
    const trend = await rpcData<TrendPayload>(request, "enterprise_daily_pricing_trend_cached", {
      p_organization_id: organizationId,
      p_days: trendDays(requestedDays),
      p_series: selectedSeries ?? null,
    });
    const series = (trend?.series ?? []).map((item) => ({
      retailer: item.label ?? (selectedBrand || "Mercado"),
      points: (item.points ?? [])
        .filter((point) => point.date && Number(point.price ?? 0) > 0)
        .map((point) => ({ date: point.date!, price: Number(point.price ?? 0), products: Number(point.skus ?? 0) })),
    }));
    return NextResponse.json({ source: "clickhouse", demoMode: true, dataSource: "supabase-demo", mode, generatedAt, series });
  }

  const [dashboard, brandContext] = await Promise.all([
    rpcData<DashboardPayload>(request, "enterprise_dashboard", { p_organization_id: organizationId }),
    selectedBrand
      ? rpcData<BrandContext>(request, "enterprise_brand_intelligence_context_v5", {
          p_organization_id: organizationId,
          p_brand: selectedBrand,
          p_retailer_type: "all",
          p_supermarket: null,
          p_category: null,
          p_stock: "all",
          p_days: Math.min(90, Math.max(7, requestedDays)),
        })
      : Promise.resolve(undefined),
  ]);
  const retailers = retailerRows(dashboard, brandContext);

  if (mode === "retailer-benchmark" || mode === "market-coverage") {
    return NextResponse.json({ source: "clickhouse", demoMode: true, dataSource: "supabase-demo", mode, generatedAt, retailers });
  }

  if (mode === "data-status") {
    return NextResponse.json({
      source: "clickhouse",
      demoMode: true,
      dataSource: "supabase-demo",
      mode,
      generatedAt,
      retailers: retailers.map((row) => ({
        retailer: row.retailer,
        vertical: "supermarket",
        products: row.products,
        latestObservedAt: row.lastObservedAt,
        observations24h: 0,
      })),
    });
  }

  if (mode === "price-gaps") {
    const priced = retailers.filter((row) => row.medianPrice > 0).sort((a, b) => a.medianPrice - b.medianPrice);
    const low = priced[0];
    const high = priced.at(-1);
    const gaps = low && high && low.retailer !== high.retailer
      ? [{
          brand: selectedBrand || "Mercado",
          category: selectedBrand ? "Portafolio de marca" : "Universo monitoreado",
          retailers: priced.length,
          products: priced.reduce((sum, row) => sum + row.products, 0),
          lowRetailer: low.retailer,
          highRetailer: high.retailer,
          lowPrice: low.medianPrice,
          highPrice: high.medianPrice,
          gapPct: low.medianPrice > 0 ? ((high.medianPrice / low.medianPrice) - 1) * 100 : 0,
        }]
      : [];
    return NextResponse.json({ source: "clickhouse", demoMode: true, dataSource: "supabase-demo", mode, generatedAt, gaps });
  }

  if (mode === "price-alerts") {
    return NextResponse.json({ source: "clickhouse", demoMode: true, dataSource: "supabase-demo", mode, generatedAt, alerts: [] });
  }

  if (mode === "products") {
    const pageSize = Math.max(1, Math.min(60, Number(params.get("pageSize") ?? 60)));
    const page = Math.max(1, Number(params.get("page") ?? 1));
    const rows = await demoProducts(request, selectedBrand, pageSize, (page - 1) * pageSize, params.get("q") ?? "");
    return NextResponse.json({
      source: "clickhouse",
      demoMode: true,
      dataSource: "supabase-demo",
      mode,
      generatedAt,
      products: rows.map((row) => ({
        id: row.id,
        name: row.name,
        brand: row.brand,
        category: row.category,
        retailer: row.supermarket,
        vertical: row.retailer_type ?? "supermarket",
        price: Number(row.offer_price ?? row.regular_price ?? 0),
        regularPrice: Number(row.regular_price ?? 0),
        inStock: row.in_stock,
        observedAt: row.observed_at,
        url: row.url ?? "",
      })),
      total: rows.length,
      page,
      pageSize,
      totalPages: rows.length < pageSize ? page : page + 1,
    });
  }

  return NextResponse.json({ source: "clickhouse", demoMode: true, dataSource: "supabase-demo", mode, generatedAt });
}

async function liveResponse(request: NextRequest, access: NonNullable<Awaited<ReturnType<typeof enterpriseAccess>>["access"]>) {
  const params = request.nextUrl.searchParams;
  if (params.get("options") === "brands") {
    return NextResponse.json({ source: "clickhouse", brands: await insightV2BrandOptions(access) }, { headers: { "cache-control": "private, max-age=300, stale-while-revalidate=900" } });
  }
  if (params.get("options") === "products") {
    return NextResponse.json({ source: "clickhouse", products: await fullHistoryProductOptions(access, params.get("brand") ?? "", days(params.get("days"))) }, { headers: { "cache-control": "private, max-age=60, stale-while-revalidate=180" } });
  }
  const raw = (params.get("mode") ?? "price-evolution") as InsightV2Mode;
  const filter = { brand: params.get("brand"), productId: params.get("productId"), days: days(params.get("days")) };
  if (raw === "price-evolution") return NextResponse.json({ source: "clickhouse", mode: raw, generatedAt: new Date().toISOString(), ...await fullHistoryEvolution(access, filter) }, { headers: { "cache-control": "private, max-age=20, stale-while-revalidate=90" } });
  if (raw === "price-alerts") return NextResponse.json({ source: "clickhouse", mode: raw, generatedAt: new Date().toISOString(), ...await fullHistoryAlerts(access, filter) }, { headers: { "cache-control": "private, max-age=20, stale-while-revalidate=90" } });
  if (V2.has(raw)) return NextResponse.json(await clickHouseInsightV2(access, raw, { ...filter, query: params.get("q"), page: Number(params.get("page") ?? 1), pageSize: Number(params.get("pageSize") ?? 60) }), { headers: { "cache-control": "private, max-age=20, stale-while-revalidate=90" } });
  const legacy = params.get("mode") === "market-coverage" ? "market-coverage" : "retailer-benchmark";
  return NextResponse.json(await clickHouseInsight(access, legacy, { brand: params.get("brand"), product: null, days: days(params.get("days")) }), { headers: { "cache-control": "private, max-age=30, stale-while-revalidate=120" } });
}

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "overview");
  if (authorization.response) return authorization.response;
  if (!authorization.access) return NextResponse.json({ error: "No fue posible resolver el acceso enterprise." }, { status: 500 });

  if (DEMO_MODE || !clickHouseConfigured()) {
    return demoResponse(request, authorization.access.organizationId);
  }

  try {
    return await liveResponse(request, authorization.access);
  } catch (error) {
    console.error("clickhouse-insight-v2", error);
    return demoResponse(request, authorization.access.organizationId);
  }
}
