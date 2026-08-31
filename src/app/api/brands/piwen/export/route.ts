import { NextRequest, NextResponse } from "next/server";
import { brandScopeAllows, enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";
import { clickHouseConfigured } from "@/lib/clickhouse";
import { piwenMarketIntelligence } from "@/lib/piwen-market";
import { piwenHistoryIntelligence } from "@/lib/piwen-history";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const FAMILIES = ["Almendras", "Castañas de cajú", "Pistachos"] as const;

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return '"' + text.replace(/"/g, '""') + '"';
}

function csv(headers: string[], rows: unknown[][]) {
  return "\uFEFFsep=,\r\n" +
    [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function safeFamily(value: string | null) {
  return FAMILIES.find((item) => item === value) ?? null;
}

function slug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-CL")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "brand-panel");
  if (authorization.response) return authorization.response;
  if (!authorization.access || !brandScopeAllows(authorization.access, "piwen")) {
    return NextResponse.json({ error: "Piwén no está habilitado para esta cuenta." }, { status: 403 });
  }
  if (!clickHouseConfigured()) {
    return NextResponse.json({ error: "ClickHouse no está disponible." }, { status: 503 });
  }

  const mode = request.nextUrl.searchParams.get("mode") === "history" ? "history" : "current";
  const family = safeFamily(request.nextUrl.searchParams.get("family"));
  const today = new Date().toISOString().slice(0, 10);

  try {
    if (mode === "history") {
      const payload = await piwenHistoryIntelligence(authorization.access);
      const points = family ? payload.points.filter((point) => point.family === family) : payload.points;
      const body = csv(
        ["Fecha", "Marca", "Familia", "Precio por kg", "SKU considerados", "Retailers", "Fuente"],
        points.map((point) => [
          point.date,
          point.brand,
          point.family,
          point.pricePerKg,
          point.skuCount,
          point.retailers,
          point.source === "market_census" ? "Censo histórico supermercados" : "Referencia pública Piwén",
        ]),
      );
      const familySuffix = family ? "-" + slug(family) : "-completo";
      return new NextResponse(body, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="piwen-historico${familySuffix}-${today}.csv"`,
          "cache-control": "private, no-store",
        },
      });
    }

    const [payload, marketplaceResult] = await Promise.all([
      piwenMarketIntelligence(authorization.access),
      enterpriseRpc<{ listings?: Array<Record<string, unknown>> }>(
        request,
        "brands_piwen_marketplace_snapshot",
        { p_slug: "piwen" },
      ),
    ]);
    const marketRows = [...payload.subject, ...payload.listings].map((row) => ({
      brand: row.brand,
      retailer: row.retailer,
      name: row.name,
      family: row.family,
      format: row.format,
      grams: row.grams,
      currentPrice: row.currentPrice,
      regularPrice: row.regularPrice,
      pricePerKg: row.pricePerKg,
      promotionPct: row.promotionPct,
      inStock: row.inStock,
      observedAt: row.observedAt,
      url: row.url,
      dataType: row.brand === "Piwén" ? "Referencia Piwén" : "Censo supermercados",
    }));
    const marketplaceRows = marketplaceResult.response ? [] : (marketplaceResult.data?.listings ?? []).map((raw) => ({
      brand: String(raw.brand ?? ""),
      retailer: String(raw.retailer ?? "MercadoLibre Chile"),
      name: String(raw.name ?? ""),
      family: String(raw.family ?? ""),
      format: String(raw.format ?? "Sin formato"),
      grams: raw.grams ?? null,
      currentPrice: raw.currentPrice ?? null,
      regularPrice: raw.regularPrice ?? null,
      pricePerKg: raw.pricePerKg ?? null,
      promotionPct: raw.promotionPct ?? null,
      inStock: raw.inStock ?? null,
      observedAt: raw.observedAt ?? null,
      url: String(raw.url ?? ""),
      dataType: "MercadoLibre Chile",
    }));
    const allRows = [...marketRows, ...marketplaceRows];
    const rows = family ? allRows.filter((row) => row.family === family) : allRows;
    const body = csv(
      ["Marca", "Retailer", "Producto", "Familia", "Formato", "Gramos", "Precio actual", "Precio regular", "Precio por kg", "Promocion %", "Stock", "Observado", "URL", "Tipo dato"],
      rows.map((row) => [
        row.brand,
        row.retailer,
        row.name,
        row.family,
        row.format,
        row.grams,
        row.currentPrice,
        row.regularPrice,
        row.pricePerKg,
        row.promotionPct,
        row.inStock === true ? "Disponible" : row.inStock === false ? "Sin stock" : "Sin confirmar",
        row.observedAt,
        row.url,
        row.dataType,
      ]),
    );
    const familySuffix = family ? "-" + slug(family) : "-completa";
    return new NextResponse(body, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="piwen-base-vigente${familySuffix}-${today}.csv"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("piwen-export", error);
    return NextResponse.json({ error: "No fue posible generar la descarga." }, { status: 503 });
  }
}
