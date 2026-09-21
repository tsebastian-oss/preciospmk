import { NextRequest, NextResponse } from "next/server";
import { gzipSync } from "node:zlib";
import { brandScopeAllows, enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const FAMILIES = ["Almendras", "Castañas de cajú", "Pistachos", "Mixes", "Nueces", "Maní", "Avellanas", "Semillas", "Fruta deshidratada"] as const;
const HISTORY_PAGE_SIZE = 5000;
const MAX_HISTORY_PAGES = 100;
const HISTORY_CONCURRENCY = 4;

type GranularHistoryRow = {
  sourceKey?: string | null;
  sourceType?: string | null;
  channel?: string | null;
  observationId?: string | null;
  runId?: string | null;
  runStartedAt?: string | null;
  runFinishedAt?: string | null;
  runStatus?: string | null;
  triggerType?: string | null;
  observedAt?: string | null;
  productId?: string | null;
  sourceProductKey?: string | null;
  retailer?: string | null;
  brand?: string | null;
  seller?: string | null;
  product?: string | null;
  family?: string | null;
  grams?: number | string | null;
  regularPrice?: number | string | null;
  offerPrice?: number | string | null;
  currentPrice?: number | string | null;
  capturedUnit?: string | null;
  capturedUnitPrice?: number | string | null;
  pricePerKg?: number | string | null;
  promotionPct?: number | string | null;
  inStock?: boolean | null;
  directComparable?: boolean | null;
  url?: string | null;
};

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return '"' + text.replace(/"/g, '""') + '"';
}

function csv(headers: string[], rows: unknown[][]) {
  const head = "\uFEFFsep=,\r\n" + headers.map(csvCell).join(",");
  const body = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  return body ? head + "\r\n" + body : head;
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

async function historyPage(request: NextRequest, family: string | null, offset: number) {
  return enterpriseRpc<{ rows?: GranularHistoryRow[]; totalRows?: number }>(
    request,
    "brands_piwen_granular_history_page",
    {
      p_slug: "piwen",
      p_offset: offset,
      p_limit: HISTORY_PAGE_SIZE,
      p_family: family,
    },
  );
}

async function granularHistory(request: NextRequest, family: string | null) {
  const first = await historyPage(request, family, 0);
  if (first.response) return { response: first.response };

  const firstRows = first.data?.rows ?? [];
  const totalRows = Number(first.data?.totalRows ?? firstRows.length);
  const totalPages = Math.ceil(totalRows / HISTORY_PAGE_SIZE);

  if (totalPages > MAX_HISTORY_PAGES) {
    throw new Error("piwen_history_export_limit");
  }

  if (totalPages <= 1) return { rows: firstRows, totalRows };

  const pages: GranularHistoryRow[][] = [firstRows];
  const offsets = Array.from(
    { length: totalPages - 1 },
    (_, index) => (index + 1) * HISTORY_PAGE_SIZE,
  );

  for (let index = 0; index < offsets.length; index += HISTORY_CONCURRENCY) {
    const chunk = offsets.slice(index, index + HISTORY_CONCURRENCY);
    const results = await Promise.all(chunk.map(offset => historyPage(request, family, offset)));

    for (const result of results) {
      if (result.response) return { response: result.response };
      pages.push(result.data?.rows ?? []);
    }
  }

  return { rows: pages.flat(), totalRows };
}

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "brand-panel");
  if (authorization.response) return authorization.response;
  if (!authorization.access || !brandScopeAllows(authorization.access, "piwen")) {
    return NextResponse.json({ error: "Piwén no está habilitado para esta cuenta." }, { status: 403 });
  }

  const mode = request.nextUrl.searchParams.get("mode") === "history" ? "history" : "current";
  const family = safeFamily(request.nextUrl.searchParams.get("family"));
  const today = new Date().toISOString().slice(0, 10);

  try {
    if (mode === "history") {
      if (!family) {
        const linkResult = await enterpriseRpc<{
          ok?: boolean;
          url?: string;
          rows?: number;
          bytes?: number;
          generatedAt?: string;
        }>(
          request,
          "brands_piwen_export_download_link",
          { p_slug: "piwen" },
        );
        if (linkResult.response) return linkResult.response;
        const signedUrl = typeof linkResult.data?.url === "string" ? linkResult.data.url : "";
        if (!signedUrl) {
          return NextResponse.json({ error: "La base histórica todavía se está preparando. Intenta nuevamente en unos segundos." }, { status: 503 });
        }
        return NextResponse.redirect(signedUrl, 307);
      }

      const historyResult = await granularHistory(request, family);
      if (historyResult.response) return historyResult.response;

      const rows = historyResult.rows ?? [];
      const body = csv(
        [
          "ID corrida",
          "Inicio corrida",
          "Fin corrida",
          "Estado corrida",
          "Tipo corrida",
          "Fecha observacion",
          "Fuente",
          "Canal",
          "Marca",
          "Retailer",
          "Seller",
          "Producto",
          "Familia",
          "SKU fuente",
          "ID producto",
          "Gramos",
          "Precio actual",
          "Precio regular",
          "Precio oferta",
          "Precio por kg",
          "Unidad capturada",
          "Precio unitario capturado",
          "Promocion %",
          "Stock",
          "Comparable directo",
          "URL",
          "ID observacion",
        ],
        rows.map((row) => [
          row.runId,
          row.runStartedAt,
          row.runFinishedAt,
          row.runStatus,
          row.triggerType,
          row.observedAt,
          row.sourceType,
          row.channel,
          row.brand,
          row.retailer,
          row.seller,
          row.product,
          row.family,
          row.sourceProductKey,
          row.productId,
          row.grams,
          row.currentPrice,
          row.regularPrice,
          row.offerPrice,
          row.pricePerKg,
          row.capturedUnit,
          row.capturedUnitPrice,
          row.promotionPct,
          row.inStock === true ? "Disponible" : row.inStock === false ? "Sin stock" : "Sin confirmar",
          row.directComparable === true ? "Sí" : row.directComparable === false ? "No" : "",
          row.url,
          row.observationId,
        ]),
      );

      const familySuffix = family ? "-" + slug(family) : "-completo";
      const compressed = gzipSync(Buffer.from(body, "utf8"), { level: 6 });
      return new NextResponse(new Uint8Array(compressed), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-encoding": "gzip",
          "content-disposition": `attachment; filename="piwen-historico-granular${familySuffix}-${today}.csv"`,
          "cache-control": "private, no-store",
          "x-piwen-export-rows": String(rows.length),
          "x-piwen-export-source": "supabase-cache",
          "vary": "accept-encoding",
        },
      });
    }

    const [supermarketResult, officialResult, marketplaceResult] = await Promise.all([
      enterpriseRpc<{ listings?: Array<Record<string, unknown>> }>(
        request,
        "brands_piwen_supermarket_snapshot",
        { p_slug: "piwen" },
      ),
      enterpriseRpc<{ listings?: Array<Record<string, unknown>> }>(
        request,
        "brands_piwen_official_snapshot",
        { p_slug: "piwen" },
      ),
      enterpriseRpc<{ listings?: Array<Record<string, unknown>> }>(
        request,
        "brands_piwen_marketplace_snapshot",
        { p_slug: "piwen" },
      ),
    ]);

    const normalizeRows = (
      rawRows: Array<Record<string, unknown>>,
      dataType: string,
      fallbackRetailer: string,
    ) => rawRows.map((raw) => ({
      brand: String(raw.brand ?? ""),
      retailer: String(raw.retailer ?? fallbackRetailer),
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
      dataType,
    }));

    const supermarketRows = supermarketResult.response
      ? []
      : normalizeRows(supermarketResult.data?.listings ?? [], "Censo supermercados", "Supermercado");

    const officialRows = officialResult.response
      ? []
      : normalizeRows(officialResult.data?.listings ?? [], "Piwén.cl oficial", "Piwén.cl");

    const marketplaceRows = marketplaceResult.response
      ? []
      : normalizeRows(marketplaceResult.data?.listings ?? [], "MercadoLibre Chile", "MercadoLibre Chile");

    const allRows = [...officialRows, ...supermarketRows, ...marketplaceRows];
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
