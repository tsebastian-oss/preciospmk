import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRODUCT_FILTER_CHUNK = 75;

type ExportJob = {
  id: string;
  organization_id: string;
  report_type: string;
  format: "xlsx" | "csv";
  status: string;
  parameters: Record<string, unknown>;
};
type Scope = { retailers: string[]; brands: string[]; categories: string[] };
type Settings = { industry_slug: string | null };
type HistoricalPrice = {
  product_id: string;
  price_date: string;
  observed_at: string;
  supermarket: string;
  retailer_type: string;
  industry_slug: string | null;
  external_id: string;
  name: string;
  brand: string | null;
  category: string | null;
  smart_category: string | null;
  url: string;
  regular_price: number | string | null;
  offer_price: number | string | null;
  effective_price: number | string;
  unit: string | null;
  unit_price: number | string | null;
  in_stock: boolean;
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" },
  });
}
function text(parameters: Record<string, unknown>, key: string) {
  const value = parameters[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function uuidArray(parameters: Record<string, unknown>, key: string) {
  const value = parameters[key];
  if (!Array.isArray(value)) return [] as string[];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && UUID_PATTERN.test(item)))].slice(0, 500);
}
function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
function csvEscape(value: unknown) {
  const raw = String(value ?? "");
  return /[",\n\r]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}
function csv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "\uFEFFSin datos\n";
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return `\uFEFF${[headers.map(csvEscape).join(","), ...rows.map((row) => headers.map((key) => csvEscape(row[key])).join(","))].join("\n")}`;
}
function safePart(value: unknown) {
  return String(value ?? "datos").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "datos";
}
function workbook(metadata: Record<string, unknown>[], rows: Record<string, unknown>[]) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(metadata), "Resumen");
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), "Detalle");
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name];
    if (!sheet["!ref"]) continue;
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    sheet["!cols"] = Array.from({ length: range.e.c + 1 }, (_, index) => ({ wch: index < 6 ? 22 : 18 }));
  }
  return new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer);
}
function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return response({ error: "method_not_allowed" }, 405);
  const authorization = request.headers.get("authorization");
  if (!authorization) return response({ error: "missing_authorization" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return response({ error: "server_configuration_error" }, 500);

  const payload = await request.json().catch(() => ({})) as { jobId?: string };
  if (!payload.jobId) return response({ error: "job_id_required" }, 400);

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: visible, error: visibleError } = await caller.from("report_jobs")
    .select("id,organization_id,report_type,format,status,parameters")
    .eq("id", payload.jobId).maybeSingle();
  if (visibleError || !visible) return response({ error: "report_not_found_or_forbidden" }, 403);
  const job = visible as ExportJob;
  if (job.report_type !== "pricing" || job.parameters?.dataset !== "historical_prices") {
    return response({ error: "unsupported_dataset" }, 400);
  }
  if (!["xlsx", "csv"].includes(job.format)) return response({ error: "unsupported_format" }, 400);

  const startDate = text(job.parameters, "startDate");
  const endDate = text(job.parameters, "endDate");
  const selectedRetailer = text(job.parameters, "supermarket");
  const selectedCategory = text(job.parameters, "category");
  const selectedProductIds = uuidArray(job.parameters, "productIds");
  if (!startDate || !endDate || !DATE_PATTERN.test(startDate) || !DATE_PATTERN.test(endDate) || startDate > endDate) {
    return response({ error: "invalid_export_period" }, 400);
  }
  if (selectedProductIds.length && !selectedCategory) return response({ error: "category_required_for_product_filter" }, 400);

  const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const generateExport = (async () => {
    await service.from("report_jobs").update({ status: "processing", started_at: new Date().toISOString(), error_message: null }).eq("id", job.id);

  try {
    const [{ data: organization, error: organizationError }, { data: scope, error: scopeError }, { data: settings, error: settingsError }] = await Promise.all([
      service.from("organizations").select("id,name,slug,plan").eq("id", job.organization_id).single(),
      service.from("organization_scopes").select("retailers,brands,categories").eq("organization_id", job.organization_id).single(),
      service.from("organization_settings").select("industry_slug").eq("organization_id", job.organization_id).single(),
    ]);
    if (organizationError || !organization) throw new Error(organizationError?.message || "organization_not_found");
    if (scopeError || !scope) throw new Error(scopeError?.message || "scope_not_found");
    if (settingsError || !settings) throw new Error(settingsError?.message || "settings_not_found");

    const allowed = scope as Scope;
    const industry = (settings as Settings).industry_slug;
    if (selectedRetailer && allowed.retailers?.length && !allowed.retailers.some((item) => item.toLowerCase() === selectedRetailer.toLowerCase())) {
      throw new Error("retailer_not_allowed");
    }

    const maxRows = job.format === "xlsx" ? 50_000 : 150_000;
    const sourceRows: HistoricalPrice[] = [];
    const pageSize = 1000;

    async function fetchRows(productIds: string[] | null, remaining: number) {
      let fetched = 0;
      for (let offset = 0; offset < remaining; offset += pageSize) {
        const batchLimit = Math.min(pageSize, remaining - offset);
        let query = service.from("enterprise_price_export_rows")
          .select("product_id,price_date,observed_at,supermarket,retailer_type,industry_slug,external_id,name,brand,category,smart_category,url,regular_price,offer_price,effective_price,unit,unit_price,in_stock")
          .gte("price_date", startDate).lte("price_date", endDate)
          .order("price_date", { ascending: false }).order("supermarket", { ascending: true }).order("external_id", { ascending: true })
          .range(offset, offset + batchLimit - 1);
        if (selectedRetailer) query = query.eq("supermarket", selectedRetailer);
        else if (allowed.retailers?.length) query = query.in("supermarket", allowed.retailers);
        if (allowed.brands?.length) query = query.in("brand", allowed.brands);
        if (allowed.categories?.length) query = query.in("category", allowed.categories);
        if (selectedCategory) query = query.eq("smart_category", selectedCategory);
        if (productIds?.length) query = query.in("product_id", productIds);
        if (industry === "grocery") query = query.eq("retailer_type", "supermarket");
        else if (industry && industry !== "all") query = query.eq("industry_slug", industry);
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        const batch = (data ?? []) as HistoricalPrice[];
        sourceRows.push(...batch);
        fetched += batch.length;
        if (batch.length < batchLimit || sourceRows.length >= maxRows) break;
      }
      return fetched;
    }

    if (selectedProductIds.length) {
      for (const productChunk of chunks(selectedProductIds, PRODUCT_FILTER_CHUNK)) {
        if (sourceRows.length >= maxRows) break;
        await fetchRows(productChunk, maxRows - sourceRows.length);
      }
    } else {
      await fetchRows(null, maxRows);
    }

    sourceRows.sort((left, right) => {
      const date = right.price_date.localeCompare(left.price_date);
      if (date) return date;
      const retailer = left.supermarket.localeCompare(right.supermarket, "es");
      if (retailer) return retailer;
      return left.external_id.localeCompare(right.external_id, "es");
    });

    const rows = sourceRows.map((item) => ({
      Fecha: item.price_date,
      Cadena: item.supermarket,
      Industria: item.industry_slug ?? "",
      SKU: item.external_id,
      Producto: item.name,
      Marca: item.brand ?? "",
      CategoriaInteligente: item.smart_category ?? "",
      CategoriaOrigen: item.category ?? "",
      PrecioRegular: item.regular_price === null ? "" : numberValue(item.regular_price),
      PrecioOferta: item.offer_price === null ? "" : numberValue(item.offer_price),
      PrecioEfectivo: numberValue(item.effective_price),
      Unidad: item.unit ?? "",
      PrecioUnitario: item.unit_price === null ? "" : numberValue(item.unit_price),
      Stock: item.in_stock ? "Disponible" : "Sin stock",
      Observado: item.observed_at,
      Fuente: item.url,
    }));
    const uniqueProducts = new Set(sourceRows.map((item) => item.product_id)).size;
    const truncated = sourceRows.length >= maxRows;
    const metadata = [
      { Indicador: "Organización", Valor: organization.name },
      { Indicador: "Industria", Valor: industry ?? "Sin configurar" },
      { Indicador: "Desde", Valor: startDate },
      { Indicador: "Hasta", Valor: endDate },
      { Indicador: "Cadena", Valor: selectedRetailer ?? "Todas las autorizadas" },
      { Indicador: "Categoría inteligente", Valor: selectedCategory ?? "Todas las categorías" },
      { Indicador: "Filtro de productos", Valor: selectedProductIds.length ? `${selectedProductIds.length} SKU seleccionados` : "Todos los productos de la categoría" },
      { Indicador: "Observaciones exportadas", Valor: rows.length },
      { Indicador: "SKU únicos", Valor: uniqueProducts },
      { Indicador: "Archivo truncado", Valor: truncated ? "Sí" : "No" },
    ];

    let bytes: Uint8Array;
    let mime: string;
    let extension: string;
    if (job.format === "xlsx") {
      bytes = workbook(metadata, rows);
      mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      extension = "xlsx";
    } else {
      bytes = new TextEncoder().encode(csv(rows));
      mime = "text/csv";
      extension = "csv";
    }

    const label = `precios-${safePart(startDate)}-${safePart(endDate)}-${safePart(selectedRetailer ?? "todas")}-${safePart(selectedCategory ?? "categorias")}-${selectedProductIds.length ? `${selectedProductIds.length}-sku` : "todos"}`;
    const storagePath = `${job.organization_id}/${job.id}-${label}.${extension}`;
    const { error: uploadError } = await service.storage.from("enterprise-reports").upload(storagePath, bytes, { contentType: mime, upsert: true });
    if (uploadError) throw new Error(uploadError.message);
    const { data: signed, error: signedError } = await service.storage.from("enterprise-reports").createSignedUrl(storagePath, 60 * 60 * 24 * 7);
    if (signedError || !signed?.signedUrl) throw new Error(signedError?.message || "signed_url_failed");

    const completedAt = new Date().toISOString();
    const { data: completed, error: updateError } = await service.from("report_jobs").update({
      status: "completed",
      result_url: signed.signedUrl,
      result_metadata: {
        storagePath,
        mime,
        bytes: bytes.byteLength,
        rows: rows.length,
        uniqueProducts,
        truncated,
        maxRows,
        industrySlug: industry,
        startDate,
        endDate,
        supermarket: selectedRetailer,
        category: selectedCategory,
        selectedProductCount: selectedProductIds.length,
        intelligentFiltering: true,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
      completed_at: completedAt,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    }).eq("id", job.id).select("*").single();
    if (updateError) throw new Error(updateError.message);
    return completed;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "export_generation_failed";
    await service.from("report_jobs").update({ status: "failed", error_message: message.slice(0, 1000), completed_at: new Date().toISOString() }).eq("id", job.id);
    console.error("enterprise_data_export_failed", { jobId: job.id, message });
    return null;
  }
  })();

  EdgeRuntime.waitUntil(generateExport);
  return response({ job, accepted: true }, 202);
});
