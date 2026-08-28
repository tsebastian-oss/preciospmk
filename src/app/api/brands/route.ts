import { NextRequest, NextResponse } from "next/server";
import { brandScopeAllows, enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";
import { BODEGAS_DON_LUIS_PAYLOAD } from "@/lib/demo-bodegas-don-luis";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const QSR_BRANDS = new Set(["krispy-kreme", "little-caesars"]);

const PIWEN_PAYLOAD = {
  brand: { id: "demo-piwen", slug: "piwen", name: "Piwén", countryCode: "CL", officialUrl: "https://www.piwen.cl/" },
  summary: { products: 6, sources: 4, listings: 12, sellers: 3, inStockPct: 100, promoPct: 25, lastObservedAt: "2026-08-28T14:30:00.000Z" },
  sources: [
    { id: "piwen-direct", retailer_name: "Piwén.cl", domain: "piwen.cl", source_type: "ecommerce_oficial", priority: 1, last_crawled_at: "2026-08-28T14:30:00.000Z", last_status: "ok_demo", last_error: null, listings: 6, in_stock: 6, min_price: 2150, max_price: 23800 },
    { id: "piwen-ml", retailer_name: "Mercado Libre · Piwén", domain: "mercadolibre.cl", source_type: "marketplace", priority: 2, last_crawled_at: "2026-08-28T14:30:00.000Z", last_status: "ok_demo", last_error: null, listings: 3, in_stock: 3, min_price: 5340, max_price: 16480 },
    { id: "piwen-wholesale", retailer_name: "Piwén Mayorista", domain: "mayorista.piwen.cl", source_type: "mayorista", priority: 2, last_crawled_at: "2026-08-28T14:30:00.000Z", last_status: "ok_demo", last_error: null, listings: 1, in_stock: 1, min_price: 30600, max_price: 30600 },
    { id: "jumbo-benchmark", retailer_name: "Jumbo · benchmark", domain: "jumbo.cl", source_type: "retail_competencia", priority: 3, last_crawled_at: "2026-08-28T14:30:00.000Z", last_status: "ok_demo", last_error: null, listings: 2, in_stock: 2, min_price: 3550, max_price: 11990 },
  ],
  products: [
    { id: "p1", sku: "PIW-ALM-250", ean: null, name: "Almendra natural 250 g", category: "Almendras", subcategory: "Frutos secos", url: "https://www.piwen.cl/", imageUrl: null, attributes: { grams: 250 }, lastSeenAt: "2026-08-28T14:30:00.000Z" },
    { id: "p2", sku: "PIW-CAJ-80", ean: null, name: "Castañas de cajú sin sal 80 g", category: "Castañas de cajú", subcategory: "Frutos secos", url: "https://www.piwen.cl/", imageUrl: null, attributes: { grams: 80 }, lastSeenAt: "2026-08-28T14:30:00.000Z" },
    { id: "p3", sku: "PIW-CAJ-1K", ean: null, name: "Castañas de cajú sin sal 1 kg", category: "Castañas de cajú", subcategory: "Frutos secos", url: "https://www.piwen.cl/", imageUrl: null, attributes: { grams: 1000 }, lastSeenAt: "2026-08-28T14:30:00.000Z" },
    { id: "p4", sku: "PIW-PIS-80", ean: null, name: "Pistacho sin sal 80 g", category: "Pistachos", subcategory: "Frutos secos", url: "https://www.piwen.cl/", imageUrl: null, attributes: { grams: 80 }, lastSeenAt: "2026-08-28T14:30:00.000Z" },
    { id: "p5", sku: "PIW-MIX-1K", ean: null, name: "Mix Aconcagua 1 kg", category: "Mixes", subcategory: "Snacks", url: "https://www.piwen.cl/", imageUrl: null, attributes: { grams: 1000 }, lastSeenAt: "2026-08-28T14:30:00.000Z" },
    { id: "p6", sku: "PIW-MIX-5K", ean: null, name: "Mix Aconcagua caja 5 kg", category: "Mixes", subcategory: "Mayorista", url: "https://mayorista.piwen.cl/", imageUrl: null, attributes: { grams: 5000 }, lastSeenAt: "2026-08-28T14:30:00.000Z" },
  ],
  listings: [
    { id: "l1", source: "Piwén.cl", domain: "piwen.cl", title: "Almendra natural 250 g", seller: "Piwén", category: "Almendras", url: "https://www.piwen.cl/", imageUrl: null, regularPrice: 5450, currentPrice: 5450, currency: "CLP", inStock: true, rating: null, reviewCount: null, observedAt: "2026-08-28T14:30:00.000Z" },
    { id: "l2", source: "Mercado Libre", domain: "mercadolibre.cl", title: "Almendra natural Piwén 250 g", seller: "Piwén", category: "Almendras", url: "https://www.mercadolibre.cl/tienda/piwen", imageUrl: null, regularPrice: 5340, currentPrice: 5340, currency: "CLP", inStock: true, rating: null, reviewCount: null, observedAt: "2026-08-28T14:30:00.000Z" },
    { id: "l3", source: "Piwén.cl", domain: "piwen.cl", title: "Castañas de cajú sin sal 1 kg", seller: "Piwén", category: "Castañas de cajú", url: "https://www.piwen.cl/", imageUrl: null, regularPrice: 23800, currentPrice: 23800, currency: "CLP", inStock: true, rating: null, reviewCount: null, observedAt: "2026-08-28T14:30:00.000Z" },
    { id: "l4", source: "Mercado Libre", domain: "mercadolibre.cl", title: "Castañas de cajú sin sal Piwén 1 kg", seller: "Piwén", category: "Castañas de cajú", url: "https://www.mercadolibre.cl/tienda/piwen", imageUrl: null, regularPrice: 16480, currentPrice: 16480, currency: "CLP", inStock: true, rating: null, reviewCount: null, observedAt: "2026-08-28T14:30:00.000Z" },
  ],
  lastRun: { status: "demo_verificada", sourcesAttempted: 4, sourcesSucceeded: 4, listingsFound: 12, productsFound: 6, startedAt: "2026-08-28T14:20:00.000Z", finishedAt: "2026-08-28T14:30:00.000Z", notes: "Demo comercial Piwén construida con referencias públicas." },
  live: {
    status: "live", mode: "persisted", freshness: "fresh", sourcePolicy: "public-demo", category: "Frutos secos", subjectBrand: "Piwén", competitorBrand: "Benchmark mercado", channel: "D2C · marketplace · retail", market: "Chile", observedAt: "2026-08-28T14:30:00.000Z",
    sources: [
      { role: "brand", brand: "Piwén", channel: "Piwén.cl + Mercado Libre", location: "Chile", url: "https://www.piwen.cl/", domain: "piwen.cl", status: "ok", observedAt: "2026-08-28T14:30:00.000Z", metrics: { items: 6, promoItems: 1, lowestPrice: 2150, maxDiscountPct: 30.8 }, error: null, items: [
        { key: "almendra-250", name: "Almendra natural 250 g", category: "Almendras", marketCategory: "Almendras", currentPrice: 5450, regularPrice: null, discountPct: null, units: null, unitPrice: 21800, benchmark: "$/kg", benchmarkLabel: "Precio por kg" },
        { key: "caju-80", name: "Castañas de cajú sin sal 80 g", category: "Castañas de cajú", marketCategory: "Castañas de cajú", currentPrice: 2150, regularPrice: null, discountPct: null, units: null, unitPrice: 26875, benchmark: "$/kg", benchmarkLabel: "Precio por kg" },
        { key: "pistacho-80", name: "Pistacho sin sal 80 g", category: "Pistachos", marketCategory: "Pistachos", currentPrice: 3150, regularPrice: null, discountPct: null, units: null, unitPrice: 39375, benchmark: "$/kg", benchmarkLabel: "Precio por kg" }
      ]},
      { role: "competitor", brand: "Benchmark mercado", channel: "Jumbo", location: "Chile", url: "https://www.jumbo.cl/", domain: "jumbo.cl", status: "ok", observedAt: "2026-08-28T14:30:00.000Z", metrics: { items: 3, promoItems: 0, lowestPrice: 3550, maxDiscountPct: null }, error: null, items: [
        { key: "almendra-bench", name: "Almendra Alto La Cruz 700 g", category: "Almendras", marketCategory: "Almendras", currentPrice: 11990, regularPrice: null, discountPct: null, units: null, unitPrice: 17129, benchmark: "$/kg", benchmarkLabel: "Precio por kg" },
        { key: "caju-bench", name: "Castañas de cajú Millantú 120 g", category: "Castañas de cajú", marketCategory: "Castañas de cajú", currentPrice: 3650, regularPrice: null, discountPct: null, units: null, unitPrice: 30417, benchmark: "$/kg", benchmarkLabel: "Precio por kg" },
        { key: "pistacho-bench", name: "Pistacho Millantú 100 g", category: "Pistachos", marketCategory: "Pistachos", currentPrice: 3550, regularPrice: null, discountPct: null, units: null, unitPrice: 35500, benchmark: "$/kg", benchmarkLabel: "Precio por kg" }
      ]}
    ],
    benchmarks: [
      { key: "almendra", label: "Almendra natural · $/kg", subject: { brand: "Piwén", price: 21800, unitPrice: 21800 }, competitor: { brand: "Alto La Cruz", price: 17129, unitPrice: 17129 }, gapPct: 27.3, leader: "Alto La Cruz", note: "Piwén opera con un premium aproximado de 27,3% en este comparable." },
      { key: "caju", label: "Castañas de cajú · $/kg", subject: { brand: "Piwén", price: 26875, unitPrice: 26875 }, competitor: { brand: "Millantú", price: 30417, unitPrice: 30417 }, gapPct: -11.6, leader: "Piwén", note: "Piwén presenta una ventaja aproximada de 11,6% en este comparable." },
      { key: "pistacho", label: "Pistacho · $/kg", subject: { brand: "Piwén", price: 39375, unitPrice: 39375 }, competitor: { brand: "Millantú", price: 35500, unitPrice: 35500 }, gapPct: 10.9, leader: "Millantú", note: "Piwén muestra un premium aproximado de 10,9% en este comparable." }
    ],
    history: {
      policy: "public-demo",
      days: 30,
      from: "2026-08-01",
      to: "2026-08-28",
      categories: ["Almendras · $/kg", "Castañas de cajú · $/kg", "Pistachos · $/kg"],
      points: [
        { date: "2026-08-01", brand: "Piwén", role: "brand", category: "Almendras · $/kg", avgPrice: 20500, avgUnitPrice: 20500, minPrice: 20500, maxPrice: 20500, products: 1 },
        { date: "2026-08-08", brand: "Piwén", role: "brand", category: "Almendras · $/kg", avgPrice: 20800, avgUnitPrice: 20800, minPrice: 20800, maxPrice: 20800, products: 1 },
        { date: "2026-08-15", brand: "Piwén", role: "brand", category: "Almendras · $/kg", avgPrice: 21400, avgUnitPrice: 21400, minPrice: 21400, maxPrice: 21400, products: 1 },
        { date: "2026-08-22", brand: "Piwén", role: "brand", category: "Almendras · $/kg", avgPrice: 21800, avgUnitPrice: 21800, minPrice: 21800, maxPrice: 21800, products: 1 },
        { date: "2026-08-28", brand: "Piwén", role: "brand", category: "Almendras · $/kg", avgPrice: 21800, avgUnitPrice: 21800, minPrice: 21800, maxPrice: 21800, products: 1 },
        { date: "2026-08-01", brand: "Benchmark mercado", role: "competitor", category: "Almendras · $/kg", avgPrice: 17900, avgUnitPrice: 17900, minPrice: 17900, maxPrice: 17900, products: 1 },
        { date: "2026-08-08", brand: "Benchmark mercado", role: "competitor", category: "Almendras · $/kg", avgPrice: 17750, avgUnitPrice: 17750, minPrice: 17750, maxPrice: 17750, products: 1 },
        { date: "2026-08-15", brand: "Benchmark mercado", role: "competitor", category: "Almendras · $/kg", avgPrice: 17500, avgUnitPrice: 17500, minPrice: 17500, maxPrice: 17500, products: 1 },
        { date: "2026-08-22", brand: "Benchmark mercado", role: "competitor", category: "Almendras · $/kg", avgPrice: 17300, avgUnitPrice: 17300, minPrice: 17300, maxPrice: 17300, products: 1 },
        { date: "2026-08-28", brand: "Benchmark mercado", role: "competitor", category: "Almendras · $/kg", avgPrice: 17129, avgUnitPrice: 17129, minPrice: 17129, maxPrice: 17129, products: 1 },

        { date: "2026-08-01", brand: "Piwén", role: "brand", category: "Castañas de cajú · $/kg", avgPrice: 27900, avgUnitPrice: 27900, minPrice: 27900, maxPrice: 27900, products: 1 },
        { date: "2026-08-08", brand: "Piwén", role: "brand", category: "Castañas de cajú · $/kg", avgPrice: 27600, avgUnitPrice: 27600, minPrice: 27600, maxPrice: 27600, products: 1 },
        { date: "2026-08-15", brand: "Piwén", role: "brand", category: "Castañas de cajú · $/kg", avgPrice: 27300, avgUnitPrice: 27300, minPrice: 27300, maxPrice: 27300, products: 1 },
        { date: "2026-08-22", brand: "Piwén", role: "brand", category: "Castañas de cajú · $/kg", avgPrice: 27000, avgUnitPrice: 27000, minPrice: 27000, maxPrice: 27000, products: 1 },
        { date: "2026-08-28", brand: "Piwén", role: "brand", category: "Castañas de cajú · $/kg", avgPrice: 26875, avgUnitPrice: 26875, minPrice: 26875, maxPrice: 26875, products: 1 },
        { date: "2026-08-01", brand: "Benchmark mercado", role: "competitor", category: "Castañas de cajú · $/kg", avgPrice: 29600, avgUnitPrice: 29600, minPrice: 29600, maxPrice: 29600, products: 1 },
        { date: "2026-08-08", brand: "Benchmark mercado", role: "competitor", category: "Castañas de cajú · $/kg", avgPrice: 29850, avgUnitPrice: 29850, minPrice: 29850, maxPrice: 29850, products: 1 },
        { date: "2026-08-15", brand: "Benchmark mercado", role: "competitor", category: "Castañas de cajú · $/kg", avgPrice: 30100, avgUnitPrice: 30100, minPrice: 30100, maxPrice: 30100, products: 1 },
        { date: "2026-08-22", brand: "Benchmark mercado", role: "competitor", category: "Castañas de cajú · $/kg", avgPrice: 30300, avgUnitPrice: 30300, minPrice: 30300, maxPrice: 30300, products: 1 },
        { date: "2026-08-28", brand: "Benchmark mercado", role: "competitor", category: "Castañas de cajú · $/kg", avgPrice: 30417, avgUnitPrice: 30417, minPrice: 30417, maxPrice: 30417, products: 1 },

        { date: "2026-08-01", brand: "Piwén", role: "brand", category: "Pistachos · $/kg", avgPrice: 38200, avgUnitPrice: 38200, minPrice: 38200, maxPrice: 38200, products: 1 },
        { date: "2026-08-08", brand: "Piwén", role: "brand", category: "Pistachos · $/kg", avgPrice: 38600, avgUnitPrice: 38600, minPrice: 38600, maxPrice: 38600, products: 1 },
        { date: "2026-08-15", brand: "Piwén", role: "brand", category: "Pistachos · $/kg", avgPrice: 38900, avgUnitPrice: 38900, minPrice: 38900, maxPrice: 38900, products: 1 },
        { date: "2026-08-22", brand: "Piwén", role: "brand", category: "Pistachos · $/kg", avgPrice: 39200, avgUnitPrice: 39200, minPrice: 39200, maxPrice: 39200, products: 1 },
        { date: "2026-08-28", brand: "Piwén", role: "brand", category: "Pistachos · $/kg", avgPrice: 39375, avgUnitPrice: 39375, minPrice: 39375, maxPrice: 39375, products: 1 },
        { date: "2026-08-01", brand: "Benchmark mercado", role: "competitor", category: "Pistachos · $/kg", avgPrice: 34800, avgUnitPrice: 34800, minPrice: 34800, maxPrice: 34800, products: 1 },
        { date: "2026-08-08", brand: "Benchmark mercado", role: "competitor", category: "Pistachos · $/kg", avgPrice: 34950, avgUnitPrice: 34950, minPrice: 34950, maxPrice: 34950, products: 1 },
        { date: "2026-08-15", brand: "Benchmark mercado", role: "competitor", category: "Pistachos · $/kg", avgPrice: 35100, avgUnitPrice: 35100, minPrice: 35100, maxPrice: 35100, products: 1 },
        { date: "2026-08-22", brand: "Benchmark mercado", role: "competitor", category: "Pistachos · $/kg", avgPrice: 35300, avgUnitPrice: 35300, minPrice: 35300, maxPrice: 35300, products: 1 },
        { date: "2026-08-28", brand: "Benchmark mercado", role: "competitor", category: "Pistachos · $/kg", avgPrice: 35500, avgUnitPrice: 35500, minPrice: 35500, maxPrice: 35500, products: 1 }
      ]
    }
  }
};


export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "brand-panel");
  if (authorization.response) return authorization.response;
  if (!authorization.access) return NextResponse.json({ error: "No fue posible resolver el acceso enterprise." }, { status: 500 });

  const slug = request.nextUrl.searchParams.get("brand")?.trim().toLowerCase() || "krispy-kreme";
  if (!brandScopeAllows(authorization.access, slug)) return NextResponse.json({ error: "Esta marca no está habilitada para tu cuenta." }, { status: 403 });

  if (slug === "piwen") {
    return NextResponse.json(PIWEN_PAYLOAD, { headers: { "cache-control": "private, max-age=60" } });
  }

  if (slug === "bodegas-don-luis") {
    try {
      const payloadResult = await enterpriseRpc<Record<string, unknown>>(request, "brands_vertical_payload_base", { p_slug: slug });
      const snapshotResult = await enterpriseRpc<Record<string, unknown>>(request, "brands_peru_liquor_snapshot", { p_slug: slug });
      const payload = payloadResult.response ? null : payloadResult.data;
      const live = snapshotResult.response ? null : snapshotResult.data;

      if (payload && payload.brand) {
        return NextResponse.json(
          { ...BODEGAS_DON_LUIS_PAYLOAD, ...payload, currency: "PEN", live: live ?? BODEGAS_DON_LUIS_PAYLOAD.live },
          { headers: { "cache-control": "private, max-age=15, stale-while-revalidate=60" } },
        );
      }
    } catch (error) {
      console.error("bodegas-don-luis-live-payload", error);
    }

    return NextResponse.json(BODEGAS_DON_LUIS_PAYLOAD, { headers: { "cache-control": "private, max-age=60" } });
  }

  try {
    const payloadResult = await enterpriseRpc<Record<string, unknown>>(request, "brands_vertical_payload_base", { p_slug: slug });
    if (payloadResult.response) return payloadResult.response;
    const payload = payloadResult.data;
    if (!payload || !payload.brand) return NextResponse.json({ error: "Marca no encontrada." }, { status: 404 });

    let live: Record<string, unknown> | null = null;
    if (QSR_BRANDS.has(slug)) {
      const snapshotFunction = slug === "krispy-kreme"
        ? "brands_qsr_official_snapshot"
        : "brands_qsr_competitive_snapshot";
      const snapshotResult = await enterpriseRpc<Record<string, unknown>>(request, snapshotFunction, { p_slug: slug });
      if (snapshotResult.response) {
        console.error("brands-qsr-snapshot", snapshotFunction, snapshotResult.response.status);
      } else {
        live = snapshotResult.data ?? null;
      }
    }

    return NextResponse.json(
      { ...payload, live },
      { headers: { "cache-control": "private, max-age=15, stale-while-revalidate=60" } },
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible cargar Brands." }, { status: 503 });
  }
}
