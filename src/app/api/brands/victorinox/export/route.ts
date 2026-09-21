import { NextRequest, NextResponse } from "next/server";
import { brandScopeAllows, enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";
import { victorinoxMarketFromRows, type RawRow } from "@/lib/victorinox-market";
import { mergeVictorinoxOfficialMarket } from "@/lib/victorinox-real-market";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Numeric = number | string;
type OfficialHistoryRow = { category: string; date: string; median_price: Numeric; products: Numeric };

function n(value: Numeric | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
function cell(value: unknown) {
  const text = value == null ? "" : String(value);
  return '"' + text.replace(/"/g, '""') + '"';
}
function csv(headers: string[], rows: unknown[][]) {
  return "\uFEFFsep=,\r\n" + [headers, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
}
function download(body: string, filename: string) {
  return new NextResponse(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
      "x-data-source": "supabase",
    },
  });
}

export async function GET(request: NextRequest) {
  const auth = await enterpriseAccess(request, "brand-panel");
  if (auth.response) return auth.response;
  if (!auth.access || !brandScopeAllows(auth.access, "victorinox")) {
    return NextResponse.json({ error: "Victorinox no está habilitado." }, { status: 403 });
  }

  const mode = request.nextUrl.searchParams.get("mode") || "current";
  if (!["current", "matrix", "history"].includes(mode)) {
    return NextResponse.json({ error: "Formato de exportación no válido." }, { status: 400 });
  }
  const today = new Date().toISOString().slice(0, 10);

  try {
    if (mode === "history") {
      const [official, competition] = await Promise.all([
        enterpriseRpc<OfficialHistoryRow[]>(request, "brands_vertical_official_history", { p_slug: "victorinox", p_days: 180 }),
        enterpriseRpc<RawRow[]>(request, "victorinox_competition_market_payload", { p_limit_per_brand: 250 }),
      ]);
      if (official.response) return official.response;
      if (competition.response) return competition.response;

      const snapshot = victorinoxMarketFromRows(Array.isArray(competition.data) ? competition.data : []);
      const positions = new Map(snapshot.position.map((item) => [item.category, item]));
      const rows = (Array.isArray(official.data) ? official.data : [])
        .filter((row) => n(row.median_price) > 0)
        .sort((a, b) => a.date.localeCompare(b.date) || a.category.localeCompare(b.category, "es"))
        .flatMap((row) => {
          const position = positions.get(row.category);
          const benchmark = n(position?.benchmarkMedian);
          if (!benchmark) return [];
          const own = n(row.median_price);
          const index = own / benchmark * 100;
          return [[
            row.date,
            row.category,
            Math.round(own),
            Math.round(benchmark),
            Math.round(index * 10) / 10,
            Math.round((index - 100) * 10) / 10,
            n(row.products),
            position?.competitors.reduce((sum, item) => sum + n(item.skuCount), 0) ?? 0,
            position?.competitors.length ?? 0,
            "Última captura competitiva disponible",
          ]];
        });

      return download(
        csv(
          ["Fecha", "Categoría", "Mediana Victorinox", "Benchmark observado", "Price Index", "Premium %", "SKU Victorinox", "SKU competencia", "Marcas competencia", "Modo benchmark"],
          rows,
        ),
        `victorinox-historico-${today}.csv`,
      );
    }

    const [light, competition] = await Promise.all([
      enterpriseRpc<Record<string, unknown>>(request, "brands_vertical_light_payload", { p_slug: "victorinox" }),
      enterpriseRpc<RawRow[]>(request, "victorinox_competition_market_payload", { p_limit_per_brand: 250 }),
    ]);
    if (light.response || !light.data) {
      return light.response ?? NextResponse.json({ error: "No fue posible cargar el catálogo oficial." }, { status: 503 });
    }
    if (competition.response || !Array.isArray(competition.data)) {
      return competition.response ?? NextResponse.json({ error: "No fue posible cargar la competencia." }, { status: 503 });
    }

    const market = mergeVictorinoxOfficialMarket(victorinoxMarketFromRows(competition.data), light.data);
    if (mode === "matrix") {
      const groups = new Map<string, typeof market.listings>();
      for (const row of market.listings) {
        const key = `${row.retailer}::${row.category}::${row.brand}`;
        groups.set(key, [...(groups.get(key) ?? []), row]);
      }
      const rows = [...groups.entries()]
        .map(([key, items]) => {
          const [retailer, category, brand] = key.split("::");
          const prices = items.map((item) => item.currentPrice).filter((price) => price > 0);
          return [retailer, category, brand, items.length, prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null];
        })
        .sort((a, b) => String(a[1]).localeCompare(String(b[1]), "es") || String(a[2]).localeCompare(String(b[2]), "es"));
      return download(csv(["Retailer", "Categoría", "Marca", "SKU", "Precio promedio"], rows), `victorinox-matriz-${today}.csv`);
    }

    return download(
      csv(
        ["Marca", "Retailer", "Producto", "Categoría", "Precio actual", "Precio regular", "Promoción %", "Stock", "Observado", "URL"],
        market.listings.map((row) => [row.brand, row.retailer, row.name, row.category, row.currentPrice, row.regularPrice, row.promotionPct, row.inStock ? "Disponible" : "Sin stock", row.observedAt, row.url]),
      ),
      `victorinox-base-vigente-${today}.csv`,
    );
  } catch (error) {
    console.error("victorinox-export", error);
    return NextResponse.json({ error: "No fue posible generar la descarga desde Supabase." }, { status: 503 });
  }
}
