import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import * as XLSX from "npm:xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json", "cache-control": "no-store" },
  });
}

function safeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "Sin datos\n";
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return [headers.map(csvEscape).join(","), ...rows.map((row) => headers.map((key) => csvEscape(row[key])).join(","))].join("\n");
}

function wrapText(text: string, maxChars: number) {
  const words = safeText(text).split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

type Product = {
  id: string;
  supermarket: string;
  external_id: string;
  name: string;
  brand: string | null;
  category: string | null;
  regular_price: number | string | null;
  offer_price: number | string | null;
  in_stock: boolean;
  observed_at: string;
  savings: number | string | null;
  discount_pct: number | string | null;
  url: string;
};
type ReportJob = { id: string; organization_id: string; report_type: string; format: "pdf" | "xlsx" | "csv"; status: string; parameters: Record<string, unknown> };
type Organization = { id: string; name: string; slug: string; organization_type: string; plan: string };
type Scope = { retailers: string[]; brands: string[]; competitors: string[]; categories: string[] };

async function fetchProducts(service: ReturnType<typeof createClient>, scope: Scope) {
  const rows: Product[] = [];
  const pageSize = 1000;
  for (let offset = 0; offset < 20_000; offset += pageSize) {
    let query = service.from("dashboard_products")
      .select("id,supermarket,external_id,name,brand,category,regular_price,offer_price,in_stock,observed_at,savings,discount_pct,url")
      .order("observed_at", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (scope.retailers?.length) query = query.in("supermarket", scope.retailers);
    if (scope.brands?.length) query = query.in("brand", scope.brands);
    if (scope.categories?.length) query = query.in("category", scope.categories);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as Product[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

function productRows(products: Product[], reportType: string) {
  let filtered = products;
  if (reportType === "promotions") filtered = products.filter((item) => numberValue(item.discount_pct) > 0);
  if (reportType === "availability") filtered = products.filter((item) => !item.in_stock);
  return filtered.map((item) => ({
    Retailer: item.supermarket,
    SKU: item.external_id,
    Producto: item.name,
    Marca: item.brand ?? "",
    Categoria: item.category ?? "",
    PrecioRegular: numberValue(item.regular_price),
    PrecioOferta: numberValue(item.offer_price),
    DescuentoPct: numberValue(item.discount_pct),
    Ahorro: numberValue(item.savings),
    Stock: item.in_stock ? "Disponible" : "Sin stock",
    Observado: item.observed_at,
    Fuente: item.url,
  }));
}

function summaryRows(products: Product[]) {
  const validPrices = products.filter((item) => numberValue(item.offer_price || item.regular_price) > 0);
  const inStock = products.filter((item) => item.in_stock);
  const offers = products.filter((item) => numberValue(item.discount_pct) > 0);
  const averagePrice = validPrices.length ? validPrices.reduce((sum, item) => sum + numberValue(item.offer_price || item.regular_price), 0) / validPrices.length : 0;
  return [
    { Indicador: "Productos monitoreados", Valor: products.length },
    { Indicador: "Productos disponibles", Valor: inStock.length },
    { Indicador: "Disponibilidad %", Valor: products.length ? Math.round(inStock.length / products.length * 10000) / 100 : 0 },
    { Indicador: "Promociones", Valor: offers.length },
    { Indicador: "Precio promedio", Valor: Math.round(averagePrice) },
    { Indicador: "Retailers", Valor: new Set(products.map((item) => item.supermarket)).size },
    { Indicador: "Marcas", Valor: new Set(products.map((item) => item.brand).filter(Boolean)).size },
    { Indicador: "Categorias", Valor: new Set(products.map((item) => item.category).filter(Boolean)).size },
  ];
}

async function reportData(service: ReturnType<typeof createClient>, job: ReportJob, scope: Scope) {
  if (job.report_type === "audit") {
    const { data, error } = await service.from("audit_logs")
      .select("created_at,action,entity_type,entity_id,actor_user_id,metadata")
      .eq("organization_id", job.organization_id)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) throw new Error(error.message);
    return { summary: [{ Indicador: "Eventos auditados", Valor: data?.length ?? 0 }], rows: (data ?? []) as Record<string, unknown>[] };
  }
  if (job.report_type === "data_quality") {
    const { data, error } = await service.from("data_quality_snapshots")
      .select("captured_at,capture_completion_pct,valid_price_pct,stock_known_pct,image_coverage_pct,match_coverage_pct,failed_tasks,stale_products,products_total")
      .or(`organization_id.eq.${job.organization_id},organization_id.is.null`)
      .order("captured_at", { ascending: false })
      .limit(90);
    if (error) throw new Error(error.message);
    const latest = data?.[0] as Record<string, unknown> | undefined;
    return { summary: latest ? Object.entries(latest).map(([Indicador, Valor]) => ({ Indicador, Valor })) : [], rows: (data ?? []) as Record<string, unknown>[] };
  }
  const products = await fetchProducts(service, scope);
  return { summary: summaryRows(products), rows: productRows(products, job.report_type) };
}

function buildWorkbook(organization: Organization, reportType: string, summary: Record<string, unknown>[], rows: Record<string, unknown>[]) {
  const workbook = XLSX.utils.book_new();
  const metadata = [
    { Campo: "Organizacion", Valor: organization.name },
    { Campo: "Tipo de reporte", Valor: reportType },
    { Campo: "Plan", Valor: organization.plan },
    { Campo: "Generado", Valor: new Date().toISOString() },
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(metadata), "Metadata");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summary), "Resumen");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Detalle");
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (sheet["!ref"]) {
      const range = XLSX.utils.decode_range(sheet["!ref"]);
      sheet["!cols"] = Array.from({ length: range.e.c + 1 }, (_, index) => ({ wch: index === 0 ? 24 : 18 }));
    }
  }
  return XLSX.write(workbook, { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer;
}

async function buildPdf(organization: Organization, reportType: string, summary: Record<string, unknown>[], rows: Record<string, unknown>[]) {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 42;
  let page = document.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;
  function nextPage() { page = document.addPage([pageWidth, pageHeight]); y = pageHeight - margin; }
  function ensure(space: number) { if (y - space < margin) nextPage(); }
  function line(text: unknown, size = 9, font = regular, color = rgb(0.17, 0.17, 0.22), indent = 0) {
    const lines = wrapText(safeText(text), Math.max(30, Math.floor((pageWidth - margin * 2 - indent) / (size * 0.52))));
    for (const item of lines) {
      ensure(size + 5);
      page.drawText(item, { x: margin + indent, y, size, font, color });
      y -= size + 5;
    }
  }
  page.drawRectangle({ x: 0, y: pageHeight - 140, width: pageWidth, height: 140, color: rgb(0.06, 0.06, 0.11) });
  page.drawText("MGP INTELLIGENCE", { x: margin, y: pageHeight - 45, size: 10, font: bold, color: rgb(0.85, 0.35, 0.95) });
  page.drawText(safeText(organization.name), { x: margin, y: pageHeight - 80, size: 25, font: bold, color: rgb(1, 1, 1) });
  page.drawText(safeText(reportType.replaceAll("_", " ").toUpperCase()), { x: margin, y: pageHeight - 105, size: 11, font: regular, color: rgb(0.78, 0.77, 0.84) });
  y = pageHeight - 175;
  line(`Generado: ${new Date().toISOString()}`, 8, regular, rgb(0.42, 0.42, 0.49));
  y -= 10;
  line("RESUMEN EJECUTIVO", 11, bold, rgb(0.45, 0.2, 0.75));
  y -= 4;
  for (const item of summary) {
    const label = safeText(item.Indicador ?? Object.keys(item)[0] ?? "Indicador");
    const value = item.Valor ?? Object.values(item)[1] ?? "";
    ensure(22);
    page.drawText(label, { x: margin, y, size: 9, font: regular, color: rgb(0.38, 0.38, 0.44) });
    page.drawText(safeText(value), { x: pageWidth - margin - 170, y, size: 10, font: bold, color: rgb(0.08, 0.08, 0.12) });
    y -= 20;
  }
  y -= 10;
  line("DETALLE", 11, bold, rgb(0.45, 0.2, 0.75));
  y -= 4;
  const maxRows = Math.min(rows.length, 400);
  for (let index = 0; index < maxRows; index++) {
    const row = rows[index];
    ensure(48);
    const title = row.Producto ?? row.entity_type ?? row.Indicador ?? `Registro ${index + 1}`;
    line(`${index + 1}. ${safeText(title)}`, 9, bold, rgb(0.08, 0.08, 0.12));
    const details = Object.entries(row).filter(([key]) => !["Producto", "Fuente", "url"].includes(key)).slice(0, 7).map(([key, value]) => `${key}: ${safeText(value)}`).join(" | ");
    line(details, 7.5, regular, rgb(0.42, 0.42, 0.49), 10);
    y -= 5;
  }
  if (rows.length > maxRows) line(`El PDF resume ${maxRows} de ${rows.length} registros. El archivo Excel o CSV contiene el detalle completo.`, 8, regular, rgb(0.55, 0.3, 0.12));
  const pages = document.getPages();
  pages.forEach((current, index) => current.drawText(`MGP Intelligence - ${index + 1}/${pages.length}`, { x: margin, y: 22, size: 7, font: regular, color: rgb(0.5, 0.5, 0.56) }));
  return await document.save();
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const authorization = request.headers.get("authorization");
  if (!authorization) return json({ error: "missing_authorization" }, 401);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: "server_configuration_error" }, 500);
  const payload = await request.json().catch(() => ({})) as { jobId?: string };
  if (!payload.jobId) return json({ error: "job_id_required" }, 400);

  const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: visibleJob, error: visibleError } = await caller.from("report_jobs").select("id,organization_id,report_type,format,status,parameters").eq("id", payload.jobId).maybeSingle();
  if (visibleError || !visibleJob) return json({ error: "report_not_found_or_forbidden" }, 403);
  const job = visibleJob as ReportJob;
  if (!["pdf", "xlsx", "csv"].includes(job.format)) return json({ error: "unsupported_format" }, 400);

  const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  await service.from("report_jobs").update({ status: "processing", started_at: new Date().toISOString(), error_message: null }).eq("id", job.id);
  try {
    const [{ data: organization, error: organizationError }, { data: scope, error: scopeError }] = await Promise.all([
      service.from("organizations").select("id,name,slug,organization_type,plan").eq("id", job.organization_id).single(),
      service.from("organization_scopes").select("retailers,brands,competitors,categories").eq("organization_id", job.organization_id).single(),
    ]);
    if (organizationError || !organization) throw new Error(organizationError?.message || "organization_not_found");
    if (scopeError || !scope) throw new Error(scopeError?.message || "scope_not_found");
    const report = await reportData(service, job, scope as Scope);
    let bytes: Uint8Array;
    let mime: string;
    let extension: string;
    if (job.format === "xlsx") {
      bytes = new Uint8Array(buildWorkbook(organization as Organization, job.report_type, report.summary, report.rows));
      mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      extension = "xlsx";
    } else if (job.format === "csv") {
      bytes = new TextEncoder().encode(toCsv(report.rows));
      mime = "text/csv";
      extension = "csv";
    } else {
      bytes = await buildPdf(organization as Organization, job.report_type, report.summary, report.rows);
      mime = "application/pdf";
      extension = "pdf";
    }
    const storagePath = `${job.organization_id}/${job.id}.${extension}`;
    const { error: uploadError } = await service.storage.from("enterprise-reports").upload(storagePath, bytes, { contentType: mime, upsert: true });
    if (uploadError) throw new Error(uploadError.message);
    const { data: signed, error: signedError } = await service.storage.from("enterprise-reports").createSignedUrl(storagePath, 60 * 60 * 24 * 7);
    if (signedError || !signed?.signedUrl) throw new Error(signedError?.message || "signed_url_failed");
    const completedAt = new Date().toISOString();
    const { data: completed, error: updateError } = await service.from("report_jobs").update({
      status: "completed",
      result_url: signed.signedUrl,
      result_metadata: { storagePath, mime, bytes: bytes.byteLength, rows: report.rows.length, summaryRows: report.summary.length, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() },
      completed_at: completedAt,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    }).eq("id", job.id).select("*").single();
    if (updateError) throw new Error(updateError.message);
    return json({ job: completed, generatedAt: completedAt });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "report_generation_failed";
    await service.from("report_jobs").update({ status: "failed", error_message: message.slice(0, 1000), completed_at: new Date().toISOString() }).eq("id", job.id);
    return json({ error: "report_generation_failed", detail: message }, 500);
  }
});
