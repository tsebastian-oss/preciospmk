import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, type EnterpriseAccessContext } from "@/lib/enterprise-auth";
import { supabaseRest } from "@/lib/supabase";
import { clickHouseConfigured } from "@/lib/clickhouse";
import {
  brandCategoryPoolFromClickHouse,
  searchBrandProductsFromClickHouse,
  type ClickHouseBrandProduct,
} from "@/lib/clickhouse-brand";

export const dynamic = "force-dynamic";

const PRODUCT_SELECT = "id,supermarket,external_id,name,brand,category,url,image_url,regular_price,offer_price,unit,unit_price,in_stock,observed_at,savings,discount_pct";
const DEFAULT_RETAILERS = ["Lider", "Jumbo", "Santa Isabel"];

type Product = ClickHouseBrandProduct;
type ProductSource = "clickhouse" | "supabase";
type ProductLoad = { rows: Product[]; source: ProductSource };

type BrandAggregate = {
  brand: string;
  products: number;
  inStock: number;
  promotions: number;
  priceTotal: number;
  priceCount: number;
};

function normalize(input: string | null | undefined) {
  return (input ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function safeSearch(input: string) {
  return input.replace(/[,*()]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

function inFilter(values: string[]) {
  const clean = values.map((item) => item.replace(/["(),]/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
  return `in.(${clean.map((item) => `"${item}"`).join(",")})`;
}

function price(product: Product) {
  const offer = Number(product.offer_price ?? 0);
  const regular = Number(product.regular_price ?? 0);
  return offer > 0 ? offer : regular > 0 ? regular : 0;
}

function average(values: number[]) {
  const valid = values.filter((item) => Number.isFinite(item) && item > 0);
  return valid.length ? valid.reduce((sum, item) => sum + item, 0) / valid.length : 0;
}

function pct(part: number, total: number) {
  return total > 0 ? part / total * 100 : 0;
}

function categoryToken(category: string | null) {
  const tokens = normalize(category).split(" ").filter((token) => token.length >= 4);
  return tokens.at(-1) ?? "";
}

function canonicalProductKey(product: Product) {
  const brand = normalize(product.brand);
  return normalize(product.name)
    .split(" ")
    .filter((token) => token && !brand.split(" ").includes(token))
    .join(" ");
}

function topEntries(map: Map<string, number>, limit: number) {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([name, products]) => ({ name, products }));
}

function selectedAllowedBrand(term: string, access: EnterpriseAccessContext) {
  if (access.isSaasAdmin || access.brands.length === 0) return term;
  const normalizedTerm = normalize(term);
  return access.brands.find((brand) => {
    const normalizedBrand = normalize(brand);
    return normalizedBrand === normalizedTerm
      || normalizedBrand.includes(normalizedTerm)
      || normalizedTerm.includes(normalizedBrand);
  }) ?? null;
}

function scopedQuery(
  query: Record<string, string>,
  access: EnterpriseAccessContext,
  includeBrandScope: boolean,
) {
  if (!access.isSaasAdmin && access.retailers.length > 0) query.supermarket = inFilter(access.retailers);
  if (!access.isSaasAdmin && access.categories.length > 0) query.category = inFilter(access.categories);
  if (!access.isSaasAdmin && includeBrandScope && access.brands.length > 0) query.brand = inFilter(access.brands);
  return query;
}

async function searchProducts(term: string, access: EnterpriseAccessContext): Promise<ProductLoad> {
  if (clickHouseConfigured()) {
    try {
      return { rows: await searchBrandProductsFromClickHouse(term, access), source: "clickhouse" };
    } catch {
      console.warn("ClickHouse Brand Intelligence search failed; falling back to Supabase.");
    }
  }

  return {
    rows: await supabaseRest<Product[]>("dashboard_products", {
      query: scopedQuery({
        select: PRODUCT_SELECT,
        or: `(brand.ilike.*${term}*,name.ilike.*${term}*)`,
        order: "in_stock.desc,observed_at.desc",
        limit: "1000",
      }, access, true),
    }),
    source: "supabase",
  };
}

async function categoryPool(category: string | null, selectedBrand: string, access: EnterpriseAccessContext): Promise<ProductLoad> {
  const token = safeSearch(categoryToken(category));
  if (!token) return { rows: [], source: clickHouseConfigured() ? "clickhouse" : "supabase" };

  if (clickHouseConfigured()) {
    try {
      return {
        rows: await brandCategoryPoolFromClickHouse(token, selectedBrand, access),
        source: "clickhouse",
      };
    } catch {
      console.warn("ClickHouse Brand Intelligence category pool failed; falling back to Supabase.");
    }
  }

  const query: Record<string, string> = {
    select: PRODUCT_SELECT,
    category: `ilike.*${token}*`,
    order: "in_stock.desc,observed_at.desc",
    limit: "2000",
  };
  if (!access.isSaasAdmin && access.retailers.length > 0) query.supermarket = inFilter(access.retailers);
  if (!access.isSaasAdmin && access.competitors.length > 0) {
    query.brand = inFilter([...new Set([selectedBrand, ...access.competitors])]);
  }
  return { rows: await supabaseRest<Product[]>("dashboard_products", { query }), source: "supabase" };
}

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "brand-overview");
  if (authorization.response) return authorization.response;
  const access = authorization.access!;

  const requestedTerm = safeSearch(request.nextUrl.searchParams.get("q") ?? "");
  if (requestedTerm.length < 2) {
    return NextResponse.json({ error: "Ingresa al menos dos caracteres para buscar una marca." }, { status: 400 });
  }
  if (access.organizationType === "brand" && access.brands.length === 0 && !access.isSaasAdmin) {
    return NextResponse.json({ error: "El administrador debe configurar al menos una marca para esta organización." }, { status: 403 });
  }
  const allowedBrand = selectedAllowedBrand(requestedTerm, access);
  if (!allowedBrand) {
    return NextResponse.json({ error: "La marca solicitada no pertenece al alcance contratado." }, { status: 403 });
  }
  const term = safeSearch(allowedBrand);
  const retailers = access.retailers.length > 0 ? access.retailers : DEFAULT_RETAILERS;

  try {
    const searchLoad = await searchProducts(term, access);
    const searchResults = searchLoad.rows;
    if (!searchResults.length) {
      return NextResponse.json({
        selectedBrand: null,
        suggestions: access.brands.map((brand) => ({ brand, products: 0 })),
        error: "No encontramos una marca o producto asociado a esa búsqueda dentro del alcance contratado.",
        dataSource: searchLoad.source,
      }, { status: 404 });
    }

    const brandCounts = new Map<string, { label: string; count: number }>();
    for (const product of searchResults) {
      if (!product.brand) continue;
      const key = normalize(product.brand);
      if (!key) continue;
      const current = brandCounts.get(key) ?? { label: product.brand, count: 0 };
      current.count += 1;
      brandCounts.set(key, current);
    }

    const normalizedTerm = normalize(term);
    const exact = [...brandCounts.entries()].find(([key]) => key === normalizedTerm);
    const rankedBrands = [...brandCounts.entries()].sort((left, right) => right[1].count - left[1].count);
    const selectedEntry = exact ?? rankedBrands[0];
    const selectedBrand = selectedEntry?.[1].label ?? searchResults.find((item) => item.brand)?.brand ?? term;
    const selectedKey = normalize(selectedBrand);
    const products = searchResults.filter((item) => normalize(item.brand) === selectedKey);
    const usableProducts = products.length ? products : searchResults;

    const categoryCounts = new Map<string, number>();
    for (const product of usableProducts) {
      const category = product.category || "Sin categoría";
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    }
    const primaryCategory = [...categoryCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
    const poolLoad = await categoryPool(primaryCategory, selectedBrand, access);
    const marketPool = poolLoad.rows;
    const dataSource = searchLoad.source === "clickhouse" && poolLoad.source === "clickhouse"
      ? "clickhouse"
      : searchLoad.source === "supabase" && poolLoad.source === "supabase"
        ? "supabase"
        : "hybrid";

    const brandPrices = usableProducts.map(price).filter((item) => item > 0);
    const marketPrices = marketPool.map(price).filter((item) => item > 0);
    const brandAveragePrice = average(brandPrices);
    const categoryAveragePrice = average(marketPrices);
    const totalProducts = usableProducts.length;
    const inStockProducts = usableProducts.filter((item) => item.in_stock).length;
    const promotions = usableProducts.filter((item) => Number(item.discount_pct ?? 0) > 0).length;
    const imageCoverage = usableProducts.filter((item) => Boolean(item.image_url)).length;
    const strongTitles = usableProducts.filter((item) => item.name.trim().length >= 20).length;

    const retailerScorecards = retailers.map((retailer) => {
      const rows = usableProducts.filter((item) => item.supermarket === retailer);
      const prices = rows.map(price).filter((item) => item > 0);
      const averagePrice = average(prices);
      const available = rows.filter((item) => item.in_stock).length;
      const promoRows = rows.filter((item) => Number(item.discount_pct ?? 0) > 0).length;
      const images = rows.filter((item) => Boolean(item.image_url)).length;
      const titleQuality = rows.filter((item) => item.name.trim().length >= 20).length;
      const availabilityPct = pct(available, rows.length);
      const imageCoveragePct = pct(images, rows.length);
      const titleQualityPct = pct(titleQuality, rows.length);
      const distributionScore = Math.min(100, pct(rows.length, Math.max(1, totalProducts / retailers.length)));
      const digitalShelfScore = Math.round(
        availabilityPct * 0.4 + imageCoveragePct * 0.2 + titleQualityPct * 0.15 + distributionScore * 0.25,
      );

      return {
        retailer,
        listings: rows.length,
        available,
        availabilityPct,
        promotions: promoRows,
        promotionPct: pct(promoRows, rows.length),
        averagePrice,
        priceIndex: brandAveragePrice > 0 ? averagePrice / brandAveragePrice * 100 : 0,
        imageCoveragePct,
        titleQualityPct,
        digitalShelfScore,
      };
    });

    const canonical = new Map<string, Set<string>>();
    for (const product of usableProducts) {
      const key = canonicalProductKey(product);
      if (!key) continue;
      const productRetailers = canonical.get(key) ?? new Set<string>();
      productRetailers.add(product.supermarket);
      canonical.set(key, productRetailers);
    }
    const coverageGaps = [...canonical.entries()]
      .filter(([, productRetailers]) => productRetailers.size < retailers.length)
      .map(([productKey, productRetailers]) => ({
        productKey,
        presentIn: [...productRetailers],
        missingIn: retailers.filter((retailer) => !productRetailers.has(retailer)),
      }))
      .sort((left, right) => right.missingIn.length - left.missingIn.length)
      .slice(0, 20);

    const competitorMap = new Map<string, BrandAggregate>();
    for (const product of marketPool) {
      const competitorBrand = product.brand?.trim();
      if (!competitorBrand || normalize(competitorBrand) === selectedKey) continue;
      const key = normalize(competitorBrand);
      const current = competitorMap.get(key) ?? {
        brand: competitorBrand,
        products: 0,
        inStock: 0,
        promotions: 0,
        priceTotal: 0,
        priceCount: 0,
      };
      current.products += 1;
      if (product.in_stock) current.inStock += 1;
      if (Number(product.discount_pct ?? 0) > 0) current.promotions += 1;
      const currentPrice = price(product);
      if (currentPrice > 0) {
        current.priceTotal += currentPrice;
        current.priceCount += 1;
      }
      competitorMap.set(key, current);
    }

    const competitors = [...competitorMap.values()]
      .sort((left, right) => right.products - left.products)
      .slice(0, 10)
      .map((item) => ({
        brand: item.brand,
        products: item.products,
        availabilityPct: pct(item.inStock, item.products),
        promotionPct: pct(item.promotions, item.products),
        averagePrice: item.priceCount ? item.priceTotal / item.priceCount : 0,
        priceIndexVsBrand: brandAveragePrice > 0 && item.priceCount
          ? (item.priceTotal / item.priceCount) / brandAveragePrice * 100
          : 0,
      }));

    const retailerPresence = retailerScorecards.filter((item) => item.listings > 0).length;
    const availabilityPct = pct(inStockProducts, totalProducts);
    const promotionPct = pct(promotions, totalProducts);
    const imageCoveragePct = pct(imageCoverage, totalProducts);
    const titleQualityPct = pct(strongTitles, totalProducts);
    const priceIndex = categoryAveragePrice > 0 ? brandAveragePrice / categoryAveragePrice * 100 : 0;
    const digitalShelfScore = Math.round(
      availabilityPct * 0.35 + imageCoveragePct * 0.2 + titleQualityPct * 0.15 + pct(retailerPresence, retailers.length) * 0.3,
    );

    const opportunities: string[] = [];
    const risks: string[] = [];
    const weakestRetailer = [...retailerScorecards]
      .filter((item) => item.listings > 0)
      .sort((left, right) => left.availabilityPct - right.availabilityPct)[0];
    const lowestCoverageRetailer = [...retailerScorecards].sort((left, right) => left.listings - right.listings)[0];

    if (weakestRetailer && weakestRetailer.availabilityPct < 80) {
      opportunities.push(`Recuperar disponibilidad en ${weakestRetailer.retailer}: hoy está en ${weakestRetailer.availabilityPct.toFixed(0)}%.`);
    }
    if (lowestCoverageRetailer && lowestCoverageRetailer.listings < totalProducts / Math.max(1, retailerPresence) * 0.65) {
      opportunities.push(`Revisar distribución en ${lowestCoverageRetailer.retailer}: su cobertura es sensiblemente menor al resto.`);
    }
    if (imageCoveragePct < 90) opportunities.push(`Completar imágenes de producto: la cobertura visual actual es ${imageCoveragePct.toFixed(0)}%.`);
    if (promotionPct < 10 && competitors.some((item) => item.promotionPct >= 15)) {
      opportunities.push("La marca está menos activa promocionalmente que competidores relevantes de la categoría.");
    }
    if (priceIndex > 108) risks.push(`La marca mantiene una prima de precio aproximada de ${(priceIndex - 100).toFixed(1)}% frente a la categoría.`);
    if (availabilityPct < 75) risks.push("La disponibilidad total puede estar limitando ventas y visibilidad digital.");
    if (coverageGaps.length > 5) risks.push(`${coverageGaps.length} referencias presentan brechas de presencia entre retailers.`);
    if (!risks.length) risks.push("No se detectaron alertas críticas con los datos públicos actualmente disponibles.");
    if (!opportunities.length) opportunities.push("Mantener monitoreo de precio, stock y promociones para detectar desviaciones tempranas.");

    const recentProducts = [...usableProducts]
      .sort((left, right) => new Date(right.observed_at).getTime() - new Date(left.observed_at).getTime())
      .slice(0, 12);

    return NextResponse.json({
      selectedBrand,
      suggestions: rankedBrands.slice(0, 8).map(([, item]) => ({ brand: item.label, products: item.count })),
      summary: {
        totalProducts,
        inStockProducts,
        availabilityPct,
        promotions,
        promotionPct,
        retailerPresence,
        averagePrice: brandAveragePrice,
        categoryAveragePrice,
        priceIndex,
        imageCoveragePct,
        titleQualityPct,
        digitalShelfScore,
        primaryCategory,
      },
      retailerScorecards,
      categoryMix: topEntries(categoryCounts, 10),
      competitors,
      coverageGaps,
      recentProducts,
      opportunities: opportunities.slice(0, 5),
      risks: risks.slice(0, 5),
      organizationId: access.organizationId,
      generatedAt: new Date().toISOString(),
      dataSource,
    });
  } catch {
    return NextResponse.json(
      { error: "No fue posible construir Brand Intelligence en este momento." },
      { status: 500 },
    );
  }
}
