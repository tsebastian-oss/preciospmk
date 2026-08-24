import { NextRequest, NextResponse } from "next/server";
import pdfParse from "pdf-parse";
import { enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const MP = "https://www.mercadopublico.cl";
const DETAIL = `${MP}/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=`;
const AWARD_BASE = `${MP}/Procurement/Modules/RFB/StepsProcessAward/`;

const PROCESS_SEEDS = [
  { id: "1611-5-LE26", processDate: "2026-05-20", origin: "Santiago Centro", buyer: "SERNAC" },
  { id: "1867-2-LE26", processDate: "2026-02-02", origin: "Santiago Centro", buyer: "Dirección General de Movilización Nacional" },
  { id: "1094080-2-LE26", processDate: "2026-03-09", origin: "Santiago Centro", buyer: "DIVBIE - Almacén Militar del Ejército" },
] as const;

const CITY_DISTANCE: Record<string, { label: string; km: number }> = {
  antofagasta: { label: "Antofagasta", km: 1089.8 }, arica: { label: "Arica", km: 1665.0 }, chillan: { label: "Chillán", km: 374.6 },
  concepcion: { label: "Concepción", km: 432.6 }, copiapo: { label: "Copiapó", km: 677.1 }, iquique: { label: "Iquique", km: 1470.7 },
  "la serena": { label: "La Serena", km: 398.2 }, "puerto montt": { label: "Puerto Montt", km: 913.9 }, rancagua: { label: "Rancagua", km: 80.5 },
  "santiago centro": { label: "Santiago Centro", km: 0 }, santiago: { label: "Santiago Centro", km: 0 }, talca: { label: "Talca", km: 237.8 },
  temuco: { label: "Temuco", km: 612.7 }, valdivia: { label: "Valdivia", km: 744.1 }, valparaiso: { label: "Valparaíso", km: 98.4 },
};

type Attachment = { control: string; name: string; type: string; sizeKb: number | null };
type RateRow = {
  source_record_id: string; source: string; source_kind: string; source_url: string; category: string; provider_name: string; provider_group: string;
  buyer_name: string | null; service_type: string; origin_label: string; destination_label: string; weight_kg: number; distance_km: number | null;
  shipment_price_clp: number; confidence: number; normalization_method: string; process_date: string; metadata: Record<string, unknown>;
};
type Extraction = {
  source_record_id: string; process_id: string; source_url: string; attachment_name: string; attachment_type: string; provider_group: string | null;
  status: string; parser: string; text_excerpt: string | null; candidate_rates: Array<Record<string, unknown>>; process_date: string; metadata: Record<string, unknown>;
};

type ProcessSeed = typeof PROCESS_SEEDS[number];

type Candidate = { providerGroup: string; providerName: string; destination: string; weightKg: number; price: number; evidence: string; confidence: number };

function normalize(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim(); }
function htmlDecode(value: string) { return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " "); }
function stripTags(value: string) { return htmlDecode(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(); }
function slug(value: string) { return normalize(value).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""); }
function parseMoney(value: string) {
  const raw = value.replace(/\s/g, "").replace(/\$/g, "");
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return null;
  const amount = Number(digits);
  return Number.isFinite(amount) && amount >= 500 && amount <= 500_000 ? amount : null;
}
function providerFromText(value: string) {
  const n = normalize(value);
  if (n.includes("chilexpress")) return { group: "Chilexpress", name: "Chilexpress S.A." };
  if (n.includes("empresa de correos de chile") || n.includes("correos de chile") || n.includes("correoschile")) return { group: "CorreosChile", name: "Empresa de Correos de Chile" };
  if (n.includes("starken")) return { group: "Starken", name: "Starken SpA" };
  if (n.includes("blue express") || n.includes("bluexpress")) return { group: "Blue Express", name: "Blue Express" };
  return null;
}
function parseWeight(value: string) {
  const n = normalize(value).replace(/,/g, ".");
  const kg = n.match(/(?:hasta|de|peso|ref\.?|referencia)?\s*(\d{1,2}(?:\.\d{1,2})?)\s*kg\b/);
  if (kg) { const v = Number(kg[1]); if (v > 0 && v <= 50) return v; }
  const grams = n.match(/(?:hasta|de|peso)?\s*(\d{2,5})\s*(?:g|gr|gramos)\b/);
  if (grams) { const v = Number(grams[1]) / 1000; if (v > 0 && v <= 50) return v; }
  if (/sobre|documento|carta/.test(n) && /500\s*(?:g|gr|gramos)/.test(n)) return 0.5;
  return null;
}
function cityFromText(value: string) {
  const n = normalize(value);
  return Object.entries(CITY_DISTANCE).find(([key]) => n.includes(key))?.[1] ?? null;
}
function priceTokens(value: string) {
  return [...value.matchAll(/\$\s*[0-9][0-9.\s]{2,12}|\b[1-9][0-9]{2,5}(?:\.[0-9]{3})+\b/g)]
    .map((match) => parseMoney(match[0])).filter((value): value is number => value !== null);
}
function hiddenInputs(html: string) {
  const params = new URLSearchParams();
  for (const match of html.matchAll(/<input[^>]+type=["']hidden["'][^>]*>/gi)) {
    const tag = match[0];
    const name = tag.match(/name=["']([^"']+)["']/i)?.[1];
    if (!name) continue;
    const value = htmlDecode(tag.match(/value=["']([^"']*)["']/i)?.[1] ?? "");
    params.set(name, value);
  }
  return params;
}
function cookieHeader(headers: Headers) {
  const anyHeaders = headers as Headers & { getSetCookie?: () => string[] };
  const raw = anyHeaders.getSetCookie?.() ?? (headers.get("set-cookie") ? [headers.get("set-cookie") as string] : []);
  const cookies: string[] = [];
  for (const item of raw) {
    for (const match of item.matchAll(/(?:^|,\s*)([A-Za-z0-9_.-]+=[^;,]+)/g)) cookies.push(match[1]);
  }
  return Array.from(new Set(cookies)).join("; ");
}
function attachments(html: string): Attachment[] {
  const rows: Attachment[] = [];
  const regex = /<tr[^>]*>[\s\S]*?id=["']DWNL_grdId_(ctl\d+)_File["'][^>]*>([\s\S]*?)<\/span>[\s\S]*?id=["']DWNL_grdId_\1_Type["'][^>]*>([\s\S]*?)<\/span>[\s\S]*?id=["']DWNL_grdId_\1_FileLength["'][^>]*>([\s\S]*?)<\/span>[\s\S]*?name=["']DWNL\$grdId\$\1\$search["']/gi;
  for (const match of html.matchAll(regex)) {
    const sizeText = stripTags(match[4]);
    const sizeMatch = sizeText.match(/([0-9.]+)\s*(KB|MB)/i);
    const sizeKb = sizeMatch ? Number(sizeMatch[1]) * (sizeMatch[2].toUpperCase() === "MB" ? 1024 : 1) : null;
    rows.push({ control: `DWNL$grdId$${match[1]}$search`, name: stripTags(match[2]), type: stripTags(match[3]), sizeKb });
  }
  return rows;
}
function relevantAttachment(item: Attachment) {
  const n = normalize(`${item.name} ${item.type}`);
  if (/conflict|declaracion jurada|ausencia/.test(n)) return false;
  return /acta|evaluacion|econom|oferta|tarif|cuadro|adjudic|resolucion/.test(n);
}
async function resolveAwardPage(processId: string) {
  const response = await fetch(`${DETAIL}${encodeURIComponent(processId)}`, { cache: "no-store", headers: { "user-agent": "Mozilla/5.0", accept: "text/html" } });
  if (!response.ok) throw new Error(`Ficha ${processId} respondió ${response.status}`);
  const html = await response.text();
  const path = html.match(/(?:StepsProcessAward\/)?PreviewAwardAct\.aspx\?qs=([^"'&<\s]+)/i)?.[1];
  if (!path) throw new Error(`No se encontró acta pública para ${processId}`);
  return `${AWARD_BASE}PreviewAwardAct.aspx?qs=${path}`;
}
async function openAwardPage(url: string) {
  const response = await fetch(url, { cache: "no-store", headers: { "user-agent": "Mozilla/5.0", accept: "text/html" } });
  if (!response.ok) throw new Error(`Acta respondió ${response.status}`);
  return { html: await response.text(), cookie: cookieHeader(response.headers) };
}
async function downloadAttachment(url: string, html: string, cookie: string, item: Attachment) {
  const params = hiddenInputs(html);
  params.set(`${item.control}.x`, "1"); params.set(`${item.control}.y`, "1");
  const response = await fetch(url, {
    method: "POST", cache: "no-store", redirect: "follow",
    headers: { "user-agent": "Mozilla/5.0", accept: "application/pdf,application/octet-stream,*/*", "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) },
    body: params.toString(),
  });
  if (!response.ok) throw new Error(`Anexo ${item.name} respondió ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 12 * 1024 * 1024) throw new Error(`Anexo ${item.name} excede 12 MB`);
  if (!buffer.subarray(0, 5).toString().startsWith("%PDF")) throw new Error(`Anexo ${item.name} no es PDF utilizable`);
  return buffer;
}

function genericCandidates(text: string, seed: ProcessSeed): Candidate[] {
  const rawLines = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const candidates: Candidate[] = [];
  let provider: ReturnType<typeof providerFromText> = null;
  let weight: number | null = null;
  for (let i = 0; i < rawLines.length; i += 1) {
    const context = rawLines.slice(Math.max(0, i - 3), Math.min(rawLines.length, i + 4)).join(" | ");
    provider = providerFromText(context) ?? provider;
    weight = parseWeight(context) ?? weight;
    const city = cityFromText(rawLines[i]) ?? cityFromText(context);
    const prices = priceTokens(rawLines[i]);
    if (!provider || !weight || !city || !prices.length) continue;
    for (const price of prices) {
      const evidence = context.slice(0, 900);
      const n = normalize(evidence);
      const unitSignal = /tarifa|precio|valor|monto unitario|oferta economica|costo/.test(n);
      if (!unitSignal) continue;
      candidates.push({ providerGroup: provider.group, providerName: provider.name, destination: city.label, weightKg: weight, price, evidence, confidence: 88 });
    }
  }
  const unique = new Map<string, Candidate>();
  for (const item of candidates) {
    const key = `${item.providerGroup}|${item.destination}|${item.weightKg}|${item.price}`;
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()].slice(0, 80);
}

function dgmNEnvelopeCandidates(text: string): Candidate[] {
  const provider = providerFromText(text);
  if (!provider) return [];
  const normalized = text.replace(/\r/g, " ").replace(/\s+/g, " ");
  const patterns: Array<{ label: string; destination: string; re: RegExp }> = [
    { label: "Sobres RM", destination: "Santiago Centro", re: /env[ií]o\s+sobres[^$0-9]{0,120}(?:regi[oó]n\s+metropolitana|rm)[^$0-9]{0,120}\$?\s*([0-9][0-9.]{2,12})/i },
  ];
  const out: Candidate[] = [];
  for (const p of patterns) {
    const match = normalized.match(p.re); const price = match ? parseMoney(match[1]) : null;
    if (price) out.push({ providerGroup: provider.group, providerName: provider.name, destination: p.destination, weightKg: 0.5, price, evidence: `${p.label}: ${match?.[0].slice(0,500)}`, confidence: 94 });
  }
  return out;
}
function extractCandidates(text: string, seed: ProcessSeed) {
  const candidates = [...genericCandidates(text, seed), ...(seed.id === "1867-2-LE26" ? dgmNEnvelopeCandidates(text) : [])];
  const unique = new Map<string, Candidate>();
  for (const item of candidates) {
    const key = `${item.providerGroup}|${item.destination}|${item.weightKg}|${item.price}`;
    const current = unique.get(key); if (!current || current.confidence < item.confidence) unique.set(key, item);
  }
  return [...unique.values()];
}
function toRateRows(candidates: Candidate[], seed: ProcessSeed, sourceUrl: string, attachment: Attachment): RateRow[] {
  return candidates.filter((item) => item.confidence >= 88).map((item) => {
    const city = CITY_DISTANCE[normalize(item.destination)];
    return {
      source_record_id: `mp-b2b-${slug(seed.id)}-${slug(attachment.name)}-${slug(item.providerGroup)}-${slug(item.destination)}-${String(item.weightKg).replace(".","_")}-${item.price}`,
      source: "mercado_publico_annex", source_kind: "mercado_publico_b2b_rate", source_url: sourceUrl, category: "courier",
      provider_name: item.providerName, provider_group: item.providerGroup, buyer_name: seed.buyer, service_type: "Courier / tarifa B2B observada",
      origin_label: seed.origin, destination_label: item.destination, weight_kg: item.weightKg, distance_km: city && city.km > 0 ? city.km : null,
      shipment_price_clp: item.price, confidence: item.confidence,
      normalization_method: "mercado_publico_public_annex+explicit_unit_rate+geodesic_city_centroid",
      process_date: seed.processDate,
      metadata: { processId: seed.id, attachment: attachment.name, evidence: item.evidence, sourceLayer: "public-sector B2B observed", distanceMethod: "city_centroid_geodesic" },
    };
  });
}

export async function POST(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "overview");
  if (authorization.response) return authorization.response;
  const body = await request.json().catch(() => ({}));
  const requested = Array.isArray(body?.processIds) ? new Set(body.processIds.map(String)) : null;
  const seeds = PROCESS_SEEDS.filter((seed) => !requested || requested.has(seed.id));
  const deadline = Date.now() + 48_000;
  const extractionRows: Extraction[] = [];
  const rateRows: RateRow[] = [];
  const warnings: string[] = [];
  let attachmentsDetected = 0;
  let pdfsRead = 0;

  for (const seed of seeds) {
    if (Date.now() >= deadline) break;
    try {
      const awardUrl = await resolveAwardPage(seed.id);
      const page = await openAwardPage(awardUrl);
      const list = attachments(page.html).filter(relevantAttachment).slice(0, 4);
      attachmentsDetected += list.length;
      for (const item of list) {
        if (Date.now() >= deadline) break;
        const base: Extraction = {
          source_record_id: `mp-annex-${slug(seed.id)}-${slug(item.name)}`, process_id: seed.id, source_url: awardUrl, attachment_name: item.name,
          attachment_type: item.type, provider_group: null, status: "detected", parser: "pdf-parse+strict-courier-v1", text_excerpt: null,
          candidate_rates: [], process_date: seed.processDate, metadata: { sizeKb: item.sizeKb, buyer: seed.buyer },
        };
        try {
          const pdf = await downloadAttachment(awardUrl, page.html, page.cookie, item); pdfsRead += 1;
          const parsed = await pdfParse(pdf);
          const text = (parsed.text || "").replace(/\u0000/g, "").trim();
          if (text.length < 80) {
            extractionRows.push({ ...base, status: "scanned", metadata: { ...base.metadata, bytes: pdf.length, pages: parsed.numpages ?? null } });
            continue;
          }
          const candidates = extractCandidates(text, seed);
          const providers = Array.from(new Set(candidates.map((x) => x.providerGroup)));
          const validRows = toRateRows(candidates, seed, awardUrl, item);
          rateRows.push(...validRows);
          extractionRows.push({
            ...base, provider_group: providers.length === 1 ? providers[0] : null, status: candidates.length ? "parsed" : "no_price",
            text_excerpt: text.slice(0, 12000), candidate_rates: candidates.map((c) => ({ providerGroup: c.providerGroup, destination: c.destination, weightKg: c.weightKg, price: c.price, confidence: c.confidence, evidence: c.evidence.slice(0,500) })),
            metadata: { ...base.metadata, bytes: pdf.length, pages: parsed.numpages ?? null, acceptedRates: validRows.length },
          });
        } catch (error) {
          extractionRows.push({ ...base, status: "error", metadata: { ...base.metadata, error: error instanceof Error ? error.message : "attachment error" } });
        }
      }
    } catch (error) {
      warnings.push(error instanceof Error ? `${seed.id}: ${error.message}` : `${seed.id}: error`);
    }
  }

  let extractionsUpserted = 0;
  if (extractionRows.length) {
    const result = await enterpriseRpc<number>(request, "b2b_upsert_annex_extractions", { p_rows: extractionRows });
    if (result.response) return result.response;
    extractionsUpserted = Number(result.data || 0);
  }
  let ratesUpserted = 0;
  if (rateRows.length) {
    const result = await enterpriseRpc<number>(request, "b2b_upsert_rate_comparables", { p_rows: rateRows });
    if (result.response) return result.response;
    ratesUpserted = Number(result.data || 0);
  }

  return NextResponse.json({
    ok: true, source: "mercado_publico_public_annexes", processes: seeds.map((x) => x.id), attachmentsDetected, pdfsRead,
    extractions: extractionRows.length, extractionsUpserted, candidateRates: extractionRows.reduce((sum,row) => sum + row.candidate_rates.length,0),
    acceptedComparableRates: rateRows.length, ratesUpserted, warnings,
    note: "Solo se incorporan a la matriz precios unitarios con proveedor, ruta/destino, peso y señal explícita de tarifa/precio. Anexos escaneados o ambiguos quedan registrados sin crear precio.",
  }, { headers: { "cache-control": "private, no-store, max-age=0" } });
}
