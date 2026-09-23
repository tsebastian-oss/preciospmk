import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, enterpriseReadRpc } from "@/lib/enterprise-auth";
import { createReadStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 300;

type Observation = {
  observation_id: string;
  product_id: string;
  crawl_run_id: string | null;
  observed_at: string;
  brand: string;
  model: string;
  version: string;
  dealer: string;
  url: string;
  regular_price: number | string | null;
  offer_price: number | string | null;
  in_stock: boolean;
  automotive_snapshot: { metadata?: Record<string, unknown> } | null;
  identity_basis: "captured_snapshot" | "legacy_identity_current";
  capture_status: string;
};
type Page = { rows: Observation[]; untilId: string; nextId: string | null };

const source = (row: Observation, field: string): number | null => {
  const value = row.automotive_snapshot?.metadata?.[field];
  const numeric = Number(value);
  return value === null || value === undefined || value === "" || !Number.isFinite(numeric) || numeric <= 0 ? null : numeric;
};
const amount = (value: number | string | null): number | null => {
  const numeric = Number(value);
  return value === null || !Number.isFinite(numeric) || numeric <= 0 ? null : numeric;
};

export async function GET(request: NextRequest) {
  const auth = await enterpriseAccess(request, "automotive");
  if (auth.response) return auth.response;
  if (!auth.access) return NextResponse.json({ message: "No se pudo resolver el acceso." }, { status: 500 });

  const params = request.nextUrl.searchParams;
  const scope = params.get("scope") ?? "all";
  if (scope !== "all" && scope !== "filtered") {
    return NextResponse.json({ message: "Selección de descarga inválida." }, { status: 400 });
  }
  const brand = scope === "filtered" ? params.get("brand")?.trim().slice(0, 180) || null : null;
  const model = scope === "filtered" ? params.get("model")?.trim().slice(0, 220) || null : null;
  const dealer = scope === "filtered" ? params.get("dealer")?.trim().slice(0, 180) || null : null;
  if (scope === "filtered" && !brand && !model && !dealer) {
    return NextResponse.json({ message: "Selecciona un filtro para descargar esta base." }, { status: 400 });
  }

  const file = join(tmpdir(), `automotive-export-${randomUUID()}.xlsx`);
  try {
    const ExcelJS = await import("exceljs");
    const book = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: file, useStyles: true, useSharedStrings: false });
    book.creator = "MGP Automotive Intelligence";
    book.created = new Date();
    const sheet = book.addWorksheet("Capturas históricas", { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.columns = [
      { header: "ID observación", key: "observationId", width: 18 },
      { header: "ID producto", key: "productId", width: 39 },
      { header: "ID corrida", key: "crawlRunId", width: 18 },
      { header: "Fecha y hora captura (UTC)", key: "observedAt", width: 27 },
      { header: "Marca", key: "brand", width: 22 },
      { header: "Modelo", key: "model", width: 28 },
      { header: "Versión", key: "version", width: 48 },
      { header: "Fuente / concesionario", key: "dealer", width: 26 },
      { header: "Precio lista guardado", key: "list", width: 23 },
      { header: "Precio final publicado", key: "final", width: 25 },
      { header: "Precio contado detallado", key: "cash", width: 25 },
      { header: "Bono marca", key: "brandBonus", width: 18 },
      { header: "Bono online", key: "onlineBonus", width: 18 },
      { header: "Bono concesionario", key: "dealerBonus", width: 22 },
      { header: "Bono financiamiento", key: "financeBonus", width: 22 },
      { header: "Disponible", key: "stock", width: 16 },
      { header: "URL fuente", key: "url", width: 70 },
      { header: "Identidad de producto", key: "identity", width: 26 },
      { header: "Estado de captura", key: "captureStatus", width: 23 },
    ];
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17324D" } };
    sheet.autoFilter = { from: "A1", to: "S1" };
    for (const key of ["list", "final", "cash", "brandBonus", "onlineBonus", "dealerBonus", "financeBonus"]) {
      sheet.getColumn(key).numFmt = '"$"#,##0;[Red]("$"#,##0)';
    }
    sheet.getRow(1).commit();

    let after = "0";
    let until: string | null = null;
    let count = 0;
    for (;;) {
      const result: Awaited<ReturnType<typeof enterpriseReadRpc<Page>>> = await enterpriseReadRpc<Page>(request, "automotive_history_page", {
        p_organization_id: auth.access.organizationId,
        p_brand: brand,
        p_model: model,
        p_dealer: dealer,
        p_after_id: after,
        p_until_id: until,
        p_page_size: 1000,
      }, { attempts: 2, timeoutMs: 25_000 });
      if (result.response) throw new Error("No se pudo recuperar una página del histórico automotriz.");
      const page: Page | undefined = result.data;
      if (!page || !Array.isArray(page.rows)) throw new Error("Página histórica inválida");
      until = page.untilId;
      for (const row of page.rows) {
        sheet.addRow({
          observationId: row.observation_id,
          productId: row.product_id,
          crawlRunId: row.crawl_run_id,
          observedAt: row.observed_at,
          brand: row.brand,
          model: row.model,
          version: row.version,
          dealer: row.dealer,
          list: amount(row.regular_price),
          final: amount(row.offer_price),
          cash: source(row, "cash_price"),
          brandBonus: source(row, "brand_bonus"),
          onlineBonus: source(row, "online_bonus"),
          dealerBonus: source(row, "dealer_bonus"),
          financeBonus: source(row, "finance_bonus"),
          stock: row.in_stock ? "Sí" : "No",
          url: row.url,
          identity: row.identity_basis === "captured_snapshot" ? "Capturada" : "Identidad actual (legado)",
          captureStatus: row.capture_status,
        }).commit();
      }
      count += page.rows.length;
      // XLSX holds at most 1,048,576 rows including the heading; never return a partial history.
      if (count > 1_048_575) throw new Error("El histórico supera el límite de filas de Excel.");
      if (!page.nextId || page.rows.length < 1000) break;
      if (BigInt(page.nextId) <= BigInt(after)) throw new Error("Paginación histórica inválida");
      after = page.nextId;
    }

    const notes = book.addWorksheet("Metodología");
    notes.columns = [{ width: 34 }, { width: 100 }];
    notes.getColumn(1).font = { bold: true };
    for (const row of [
      ["Alcance", "Cada fila corresponde a una observación almacenada, incluso cuando se repite una versión en distintas corridas."],
      ["Total de observaciones", count],
      ["Última observación incluida (ID)", until],
      ["Precio lista", "Precio regular guardado en la observación; vacío cuando no se registró."],
      ["Precio final publicado", "Precio de oferta guardado en la observación; vacío cuando no se registró."],
      ["Precio contado y bonos", "Disponibles sólo para capturas que contienen una instantánea de metadatos. Un campo vacío no significa cero."],
      ["Registros legados", "La identidad, modelo, fuente y URL de observaciones anteriores a las instantáneas provienen del registro actual de producto."],
      ["Calidad de captura", "El histórico completo incluye registros rechazados o de identidad inválida para auditoría; use Estado de captura para filtrarlos."],
      ["Zona horaria de captura", "UTC en formato ISO 8601."],
    ]) notes.addRow(row).commit();
    sheet.commit();
    notes.commit();
    await book.commit();
    const fileStream = createReadStream(file);
    fileStream.once("close", () => { void unlink(file).catch(() => {}); });
    return new NextResponse(Readable.toWeb(fileStream) as BodyInit, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="automotriz-historico-${scope}-${new Date().toISOString().slice(0, 10)}.xlsx"`,
        "cache-control": "private, no-store, max-age=0",
      },
    });
  } catch (error) {
    await unlink(file).catch(() => {});
    console.error("automotive-export", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ message: "No fue posible generar el Excel histórico completo. Intenta nuevamente." }, { status: 503 });
  }
}
